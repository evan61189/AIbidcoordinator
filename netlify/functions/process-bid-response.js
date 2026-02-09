/**
 * Process Inbound Bid Responses from SendGrid Inbound Parse
 *
 * Receives emails from subcontractors, parses body + attachments,
 * uses Claude AI to extract bid data, and saves to database for leveling.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import busboy from 'busboy'

// Netlify function configuration
export const config = {
  maxDuration: 300 // 5 minutes for AI processing
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

// Initialize clients (inside handler to ensure env vars are loaded)
let supabase = null
let anthropic = null

function initClients() {
  if (!supabase && process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    )
  }
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })
  }
}

/**
 * Parse multipart/form-data from SendGrid Inbound Parse
 */
async function parseInboundEmail(event) {
  return new Promise((resolve, reject) => {
    const fields = {}
    const attachments = []

    const contentType = event.headers['content-type'] || event.headers['Content-Type']

    if (!contentType || !contentType.includes('multipart/form-data')) {
      // Try to parse as JSON (for testing)
      try {
        const data = JSON.parse(event.body)
        resolve({ fields: data, attachments: [] })
        return
      } catch {
        reject(new Error('Expected multipart/form-data or JSON'))
        return
      }
    }

    const bb = busboy({ headers: { 'content-type': contentType } })

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info
      const chunks = []

      file.on('data', (chunk) => {
        chunks.push(chunk)
      })

      file.on('end', () => {
        const buffer = Buffer.concat(chunks)
        attachments.push({
          fieldName: name,
          filename: filename,
          contentType: mimeType,
          size: buffer.length,
          data: buffer.toString('base64')
        })
      })
    })

    bb.on('finish', () => {
      resolve({ fields, attachments })
    })

    bb.on('error', (err) => {
      reject(err)
    })

    // Handle base64 encoded body
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body

    bb.end(body)
  })
}

/**
 * Find matching invitation/project/subcontractor by sender email
 * Also fetches packages associated with the invitation for clarification workflow
 */
async function findMatchingContext(fromEmail, subject) {
  if (!supabase) return null

  // First, try to find by subcontractor email
  const { data: subs } = await supabase
    .from('subcontractors')
    .select('id, company_name, email, contact_name')
    .ilike('email', fromEmail)
    .limit(1)

  const subcontractor = subs?.[0]

  // Look for recent invitations to this email
  const { data: invitations } = await supabase
    .from('bid_invitations')
    .select(`
      id,
      project_id,
      subcontractor_id,
      tracking_token,
      bid_item_ids,
      projects:project_id (id, name)
    `)
    .ilike('to_email', fromEmail)
    .order('sent_at', { ascending: false })
    .limit(5)

  // Try to match by project name in subject
  let matchedInvitation = invitations?.[0]
  if (invitations && invitations.length > 1 && subject) {
    for (const inv of invitations) {
      if (inv.projects?.name && subject.toLowerCase().includes(inv.projects.name.toLowerCase())) {
        matchedInvitation = inv
        break
      }
    }
  }

  // Get packages for the matched invitation's bid items
  let invitedPackages = []
  if (matchedInvitation?.bid_item_ids?.length > 0) {
    const { data: packageItems } = await supabase
      .from('scope_package_items')
      .select(`
        bid_item_id,
        scope_packages:scope_package_id (id, name)
      `)
      .in('bid_item_id', matchedInvitation.bid_item_ids)

    if (packageItems?.length > 0) {
      // Get unique package names
      const packageMap = new Map()
      for (const item of packageItems) {
        if (item.scope_packages?.name) {
          packageMap.set(item.scope_packages.id, item.scope_packages.name)
        }
      }
      invitedPackages = Array.from(packageMap.entries()).map(([id, name]) => ({ id, name }))
    }
  }

  // Check if there's a pending clarification request for this sub/project
  let pendingClarification = null
  if (subcontractor?.id && matchedInvitation?.project_id) {
    const { data: clarification } = await supabase
      .from('bid_clarifications')
      .select('*')
      .eq('project_id', matchedInvitation.project_id)
      .eq('subcontractor_id', subcontractor.id)
      .eq('status', 'pending')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single()

    pendingClarification = clarification
  }

  return {
    subcontractor,
    invitation: matchedInvitation,
    project: matchedInvitation?.projects,
    invitedPackages,
    pendingClarification
  }
}

/**
 * Analyze email body and attachments with Claude AI
 * @param {string} emailBody - The email body text
 * @param {Array} attachments - Array of attachment objects
 * @param {Array} invitedPackages - Array of package names to look for pricing breakdown
 */
async function analyzeWithAI(emailBody, attachments, invitedPackages = []) {
  if (!anthropic) {
    throw new Error('Anthropic client not initialized')
  }

  // Build content array for Claude
  const content = []

  // Add email body context
  if (emailBody && emailBody.trim()) {
    content.push({
      type: 'text',
      text: `EMAIL BODY:\n${emailBody}\n\n---\n`
    })
  }

  // Add attachments (PDFs and images)
  for (const attachment of attachments) {
    const { contentType, data, filename } = attachment

    if (contentType === 'application/pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: data
        }
      })
      content.push({
        type: 'text',
        text: `[Above is PDF attachment: ${filename}]\n`
      })
    } else if (contentType.startsWith('image/')) {
      const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      if (supportedTypes.includes(contentType)) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: contentType,
            data: data
          }
        })
        content.push({
          type: 'text',
          text: `[Above is image attachment: ${filename}]\n`
        })
      }
    }
    // For Excel/CSV files, we'd need additional parsing - noted in analysis
  }

  // Build package-specific extraction instructions
  const packageNames = invitedPackages.map(p => p.name || p)
  const packageInstructions = packageNames.length > 1
    ? `
IMPORTANT - PACKAGE BREAKDOWN:
This bid was requested for multiple packages: ${packageNames.join(', ')}

If the subcontractor provides SEPARATE pricing for each package, extract it into "amounts_by_package".
If they only provide a single LUMP SUM for all packages combined, leave "amounts_by_package" as null or empty.

Look for:
- Explicit breakdown like "Electrical: $50,000, Fire Alarm: $25,000"
- A table or list with package names and prices
- References to specific package pricing in email body or attachments`
    : ''

  // Add extraction prompt
  content.push({
    type: 'text',
    text: `Based on the email body and any attachments above, extract the bid/quote information.
${packageInstructions}

CRITICAL - DISTINGUISHING LUMP SUM vs LINE ITEM BIDS:

A "LUMP SUM" bid is when:
- There is ONE total price for all work
- Scope items may be LISTED but do NOT have individual prices
- Example: "Total: $150,000" with a list of included work items (no prices per item)
- The scope list describes WHAT is included, not how the price breaks down

A "LINE ITEM" bid is when:
- EACH item has its OWN individual price
- Prices add up to a total
- Example: "Conduit: $20,000, Wiring: $50,000, Panels: $30,000, Total: $100,000"

IMPORTANT: If you see a list of scope items WITHOUT individual prices next to each item,
this is a LUMP SUM bid. Put those items in "scope_included" as text, NOT in "line_items".
Only populate "line_items" when items have their own dollar amounts.

ALSO DETECT:
1. RFIs/QUESTIONS: Look for questions, clarifications needed, or RFIs in the email. These are requests for information about scope, drawings, specs, schedule, etc.
2. FORWARDED EMAILS: Check if this appears to be a forwarded email (look for "Fwd:", "FW:", "Forwarded message", "---------- Forwarded message ----------", or similar). If so, extract the ORIGINAL sender's info.
3. SENDER IDENTIFICATION FROM ATTACHMENTS: If PDFs are attached, look for company letterheads, signatures, contact info to identify who the bid/document is from.

Return JSON only:
{
  "total_amount": number or null,
  "is_lump_sum": true if single price covers all work (even if scope items are listed without prices), false if individually priced line items,
  "amounts_by_package": ${packageNames.length > 1 ? `{ "${packageNames.join('": number, "')}" : number } or null if only lump sum provided` : 'null'},
  "is_lump_sum_for_multiple": ${packageNames.length > 1 ? 'true if single lump sum covers multiple packages without per-package breakdown, false if breakdown provided' : 'false'},
  "line_items": [
    {
      "description": "Item description",
      "quantity": "Qty or null",
      "unit": "Unit or null",
      "unit_price": number or null,
      "total": number (REQUIRED - only include items that have their own price),
      "trade": "Trade/division name"
    }
  ],
  "scope_included": "Bullet list or description of all work/items included in the bid (especially for lump sum bids where items are listed without individual prices)",
  "scope_excluded": "What is explicitly excluded",
  "clarifications": "Any clarifications, assumptions, or conditions",
  "alternates": [
    {
      "description": "Alternate description",
      "add_amount": number or null,
      "deduct_amount": number or null
    }
  ],
  "payment_terms": "Payment terms if mentioned",
  "lead_time": "Lead time or schedule if mentioned",
  "valid_until": "Quote validity date if mentioned (YYYY-MM-DD)",
  "warranty_info": "Warranty information if mentioned",
  "rfis": [
    {
      "subject": "Brief summary of the question",
      "question": "Full question text",
      "category": "scope_clarification | drawing_conflict | spec_question | schedule | pricing | substitution | other",
      "priority": "normal | high | urgent (based on language used)",
      "drawing_reference": "Referenced drawing/sheet if any",
      "spec_reference": "Referenced spec section if any"
    }
  ],
  "is_forwarded_email": true if this appears to be forwarded, false otherwise,
  "original_sender": {
    "company_name": "Original sender company from forwarded email or PDF letterhead",
    "contact_name": "Original sender name",
    "email": "Original sender email if visible",
    "phone": "Phone number if visible"
  },
  "identified_project": "Project name/number if mentioned in the email or documents",
  "identified_trade": "Trade/division this bid appears to be for (e.g., Electrical, Plumbing, HVAC)",
  "confidence_score": 0.0 to 1.0,
  "analysis_notes": "Note whether this is a lump sum or itemized bid, if it contains RFIs, if it's forwarded, and any important observations"
}`
  })

  console.log(`Calling Claude AI with ${content.length} content blocks...`)
  const startTime = Date.now()

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: `You are an expert construction bid analyst. Extract pricing, scope, and RFI information from subcontractor communications.

CRITICAL DISTINCTION - Lump Sum vs Line Items:
- LUMP SUM: One total price with a list of included scope/work items (items have NO individual prices)
- LINE ITEMS: Each item has its OWN dollar amount that adds up to the total

Many contractors list what's included in their bid WITHOUT pricing each item - this is still a LUMP SUM bid.
Only extract "line_items" when each item has an explicit dollar amount. Otherwise, put the scope list in "scope_included".

RFI DETECTION:
- Look for questions, clarification requests, or information requests about scope, drawings, specs, schedule, etc.
- Extract each distinct question as a separate RFI
- RFIs may be mixed in with bid information - extract both

FORWARDED EMAIL DETECTION:
- Look for indicators like "Fwd:", "FW:", "Forwarded message", "From:" within the body, or similar
- If forwarded, extract the ORIGINAL sender's company/contact info from the forwarded content
- This helps match bids when PMs forward subcontractor emails

Be thorough - analyze BOTH the email body AND any attached documents.
Look at PDF letterheads, signatures, and contact info to identify the sending company.
The email body often contains important clarifications, exclusions, or conditions not in the formal quote.
Return only valid JSON.`,
    messages: [
      {
        role: 'user',
        content: content
      }
    ]
  })

  const elapsed = Date.now() - startTime
  console.log(`Claude responded in ${elapsed}ms`)

  const responseText = message.content[0].text

  // Parse JSON from response
  try {
    // Try code block first
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim())
    }

    // Find JSON object
    const jsonStart = responseText.indexOf('{')
    if (jsonStart !== -1) {
      let braceCount = 0
      let jsonEnd = -1
      for (let i = jsonStart; i < responseText.length; i++) {
        if (responseText[i] === '{') braceCount++
        if (responseText[i] === '}') braceCount--
        if (braceCount === 0) {
          jsonEnd = i + 1
          break
        }
      }
      if (jsonEnd > jsonStart) {
        return JSON.parse(responseText.substring(jsonStart, jsonEnd))
      }
    }

    // Fallback
    return JSON.parse(responseText)
  } catch (parseError) {
    console.error('Failed to parse AI response:', parseError.message)
    return {
      analysis_notes: 'Failed to parse structured data',
      raw_response: responseText,
      confidence_score: 0
    }
  }
}

/**
 * Send clarification email requesting per-package breakdown
 */
async function sendClarificationEmail(context, parsedBid) {
  const { subcontractor, project, invitedPackages } = context

  if (!subcontractor?.email || !project?.name || !invitedPackages?.length) {
    console.log('Missing required data for clarification email')
    return null
  }

  const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send'
  const apiKey = process.env.SENDGRID_API_KEY

  if (!apiKey) {
    console.error('SENDGRID_API_KEY not configured')
    return null
  }

  const packageNames = invitedPackages.map(p => p.name || p)
  const formattedAmount = parsedBid.total_amount
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parsedBid.total_amount)
    : 'the amount provided'

  // Build packages list for email
  const packagesListHtml = packageNames.map((pkg, i) => `
    <tr style="background-color: ${i % 2 === 0 ? '#f9f9f9' : 'white'};">
      <td style="padding: 12px; border: 1px solid #ddd;">${pkg}</td>
      <td style="padding: 12px; border: 1px solid #ddd; text-align: right;">$_____________</td>
    </tr>
  `).join('')

  const packagesListText = packageNames.map(pkg => `  - ${pkg}: $_____________`).join('\n')

  const subject = `Clarification Needed: Pricing Breakdown for ${project.name}`

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
        .header { background-color: #e67e22; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .highlight { background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #ddd; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Pricing Clarification Request</h1>
      </div>

      <div class="content">
        <p>Dear ${subcontractor.contact_name || subcontractor.company_name || 'Contractor'},</p>

        <p>Thank you for submitting your bid for <strong>${project.name}</strong>.</p>

        <div class="highlight">
          <p><strong>Clarification Needed:</strong></p>
          <p>We received your lump sum bid of <strong>${formattedAmount}</strong>, which appears to cover multiple bid packages. To properly evaluate your proposal and ensure accurate comparison with other bidders, we need a breakdown of pricing by package.</p>
        </div>

        <p>Please provide individual pricing for each of the following packages:</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background-color: #2c3e50; color: white;">
              <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Bid Package</th>
              <th style="padding: 12px; text-align: right; border: 1px solid #ddd;">Your Price</th>
            </tr>
          </thead>
          <tbody>
            ${packagesListHtml}
            <tr style="background-color: #e8f4f8; font-weight: bold;">
              <td style="padding: 12px; border: 1px solid #ddd;">TOTAL</td>
              <td style="padding: 12px; border: 1px solid #ddd; text-align: right;">${formattedAmount}</td>
            </tr>
          </tbody>
        </table>

        <p><strong>Why we need this breakdown:</strong></p>
        <ul>
          <li>Each package may be awarded to different subcontractors based on competitive pricing</li>
          <li>Accurate package pricing helps with project budgeting and cost tracking</li>
          <li>It ensures fair comparison between all bidders</li>
        </ul>

        <p>Please reply to this email with your pricing breakdown at your earliest convenience. Your total should match your original bid of ${formattedAmount}.</p>

        <p style="margin-top: 30px;">If you have any questions or need clarification on the package scope, please don't hesitate to reach out.</p>

        <p>Thank you for your cooperation.</p>

        <p>Best regards,<br>
        The Estimating Team</p>
      </div>

      <div class="footer">
        <p>This clarification request was sent via BidCoordinator</p>
      </div>
    </body>
    </html>
  `

  const textContent = `
PRICING CLARIFICATION REQUEST

Dear ${subcontractor.contact_name || subcontractor.company_name || 'Contractor'},

Thank you for submitting your bid for ${project.name}.

CLARIFICATION NEEDED:
We received your lump sum bid of ${formattedAmount}, which appears to cover multiple bid packages. To properly evaluate your proposal and ensure accurate comparison with other bidders, we need a breakdown of pricing by package.

Please provide individual pricing for each of the following packages:

${packagesListText}
  -----------------------------------------
  TOTAL: ${formattedAmount}

WHY WE NEED THIS BREAKDOWN:
- Each package may be awarded to different subcontractors based on competitive pricing
- Accurate package pricing helps with project budgeting and cost tracking
- It ensures fair comparison between all bidders

Please reply to this email with your pricing breakdown at your earliest convenience. Your total should match your original bid of ${formattedAmount}.

Thank you for your cooperation.

Best regards,
The Estimating Team
  `.trim()

  const sendGridPayload = {
    personalizations: [{
      to: [{ email: subcontractor.email, name: subcontractor.company_name }],
      subject: subject
    }],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@bidcoordinator.com',
      name: 'BidCoordinator'
    },
    reply_to: process.env.SENDGRID_INBOUND_EMAIL
      ? { email: process.env.SENDGRID_INBOUND_EMAIL, name: 'Clipper Construction Bids' }
      : undefined,
    content: [
      { type: 'text/plain', value: textContent },
      { type: 'text/html', value: htmlContent }
    ]
  }

  try {
    const response = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sendGridPayload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('SendGrid clarification email error:', errorText)
      return null
    }

    // Track clarification request in database
    if (supabase && project.id && subcontractor.id) {
      try {
        await supabase
          .from('bid_clarifications')
          .insert({
            project_id: project.id,
            subcontractor_id: subcontractor.id,
            packages_requested: packageNames,
            lump_sum_amount: parsedBid.total_amount,
            status: 'pending',
            sent_at: new Date().toISOString()
          })
        console.log('Clarification request tracked in database')
      } catch (trackError) {
        console.warn('Error tracking clarification request:', trackError.message)
      }
    }

    console.log(`Clarification email sent to ${subcontractor.email} for packages: ${packageNames.join(', ')}`)
    return { sent: true, packages: packageNames }
  } catch (error) {
    console.error('Error sending clarification email:', error)
    return null
  }
}

/**
 * Call AI to suggest allocation for a package bid
 */
async function suggestBidAllocation(packageBid, packageItems, packageName) {
  if (!anthropic || !packageItems?.length) return null

  try {
    // Build items list for AI
    const items = packageItems.map(pi => ({
      id: pi.bid_item?.id || pi.bid_item_id,
      description: pi.bid_item?.description || 'Unknown item',
      division_code: pi.bid_item?.trade?.division_code || '00',
      division_name: pi.bid_item?.trade?.name || 'Unknown'
    }))

    // Group by division for the prompt
    const itemsByDivision = {}
    for (const item of items) {
      if (!itemsByDivision[item.division_code]) {
        itemsByDivision[item.division_code] = { name: item.division_name, items: [] }
      }
      itemsByDivision[item.division_code].items.push(item)
    }

    const itemsList = Object.entries(itemsByDivision).map(([code, div]) => {
      const itemDescriptions = div.items.map(i => `  - ${i.id}: ${i.description}`).join('\n')
      return `Division ${code} - ${div.name}:\n${itemDescriptions}`
    }).join('\n\n')

    const prompt = `Package: ${packageName}
Total Bid Amount: $${packageBid.amount.toLocaleString()}

Items by Division:
${itemsList}

Based on typical construction costs, suggest how to allocate $${packageBid.amount.toLocaleString()} across these divisions and items.

Return JSON with this structure:
{
  "division_allocations": {
    "DIVISION_CODE": { "percent": NUMBER, "amount": NUMBER }
  },
  "item_allocations": {
    "ITEM_ID": { "amount": NUMBER }
  }
}

Division amounts must sum to ${packageBid.amount}. Item amounts within each division must sum to that division's amount.`

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      temperature: 0,
      system: 'You are a construction cost estimation expert. Distribute bid amounts realistically based on typical costs. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    const allocation = JSON.parse(match[0])

    // Normalize amounts to sum correctly
    const divAllocations = allocation.division_allocations || {}
    const itemAllocations = allocation.item_allocations || {}

    // Scale division amounts if needed
    let divSum = Object.values(divAllocations).reduce((sum, d) => sum + (d.amount || 0), 0)
    if (divSum > 0 && divSum !== packageBid.amount) {
      const scale = packageBid.amount / divSum
      for (const code of Object.keys(divAllocations)) {
        divAllocations[code].amount = Math.round(divAllocations[code].amount * scale)
        divAllocations[code].percent = Math.round((divAllocations[code].amount / packageBid.amount) * 1000) / 10
      }
    }

    return { division_allocations: divAllocations, item_allocations: itemAllocations }
  } catch (error) {
    console.error('Error suggesting allocation:', error.message)
    return null
  }
}

/**
 * Save per-package bids from a clarification response to package_bids table
 */
async function savePerPackageBids(context, parsedBid, bidResponseId = null) {
  if (!supabase) return null

  const { subcontractor, project, invitedPackages, pendingClarification } = context
  const { amounts_by_package } = parsedBid

  if (!amounts_by_package || Object.keys(amounts_by_package).length === 0) {
    return null
  }

  const results = []

  for (const [packageName, amount] of Object.entries(amounts_by_package)) {
    // Find the package (case-insensitive match)
    const pkg = invitedPackages.find(p =>
      (p.name || p).toLowerCase() === packageName.toLowerCase()
    )

    if (!pkg) {
      console.log(`Package not found for: ${packageName}`)
      continue
    }

    // Get package items with division info for allocation
    const { data: packageItems } = await supabase
      .from('scope_package_items')
      .select(`
        bid_item_id,
        bid_item:bid_items (
          id, description,
          trade:trades (id, name, division_code)
        )
      `)
      .eq('scope_package_id', pkg.id)

    // Create a package-level bid in the package_bids table
    const { data: packageBid, error } = await supabase
      .from('package_bids')
      .insert({
        project_id: project.id,
        scope_package_id: pkg.id,
        subcontractor_id: subcontractor.id,
        amount: amount,
        status: 'pending_approval',
        source: pendingClarification ? 'clarification_response' : 'email',
        bid_response_id: bidResponseId,
        clarification_id: pendingClarification?.id,
        scope_included: parsedBid.scope_included,
        scope_excluded: parsedBid.scope_excluded,
        clarifications: parsedBid.clarifications,
        notes: `Package bid for ${packageName}`,
        submitted_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error(`Error creating package bid for ${packageName}:`, error)
    } else {
      results.push({ package: packageName, package_bid_id: packageBid.id, amount })
      console.log(`Created package bid for ${packageName}: $${amount}`)

      // Auto-suggest allocation if package has items in multiple divisions
      if (packageItems && packageItems.length > 0) {
        const divisionCodes = new Set(packageItems.map(pi => pi.bid_item?.trade?.division_code).filter(Boolean))

        if (divisionCodes.size > 1) {
          console.log(`Package "${packageName}" spans ${divisionCodes.size} divisions, suggesting allocation...`)
          const allocation = await suggestBidAllocation(packageBid, packageItems, packageName)

          if (allocation) {
            // Save allocation to the package bid
            await supabase
              .from('package_bids')
              .update({
                allocation_method: 'ai_suggested',
                division_allocations: allocation.division_allocations,
                item_allocations: allocation.item_allocations
              })
              .eq('id', packageBid.id)

            console.log(`Saved AI allocation for "${packageName}":`, Object.keys(allocation.division_allocations))
            results[results.length - 1].allocation = allocation
          }
        } else {
          // Single division - even allocation
          const divCode = Array.from(divisionCodes)[0] || '00'
          const evenAllocation = {
            division_allocations: {
              [divCode]: { percent: 100, amount: amount }
            },
            item_allocations: {}
          }

          // Distribute evenly among items
          const perItem = Math.round(amount / packageItems.length)
          for (const pi of packageItems) {
            evenAllocation.item_allocations[pi.bid_item_id] = { amount: perItem }
          }

          await supabase
            .from('package_bids')
            .update({
              allocation_method: 'even',
              division_allocations: evenAllocation.division_allocations,
              item_allocations: evenAllocation.item_allocations
            })
            .eq('id', packageBid.id)
        }
      }
    }
  }

  // Update clarification status to resolved
  if (pendingClarification?.id) {
    await supabase
      .from('bid_clarifications')
      .update({
        status: 'resolved',
        responded_at: new Date().toISOString(),
        package_amounts: amounts_by_package
      })
      .eq('id', pendingClarification.id)
    console.log('Clarification marked as resolved')
  }

  return results
}

/**
 * Save RFIs extracted from email to the database
 */
async function saveRFIs(rfis, context, inboundEmailId) {
  if (!supabase || !rfis || rfis.length === 0) return null

  const projectId = context?.project?.id
  const subcontractorId = context?.subcontractor?.id

  if (!projectId) {
    console.log('No project context for RFIs - cannot save')
    return null
  }

  const results = []
  for (const rfi of rfis) {
    try {
      const { data, error } = await supabase
        .from('rfis')
        .insert({
          project_id: projectId,
          subcontractor_id: subcontractorId,
          subject: rfi.subject || 'Question from subcontractor',
          question: rfi.question,
          category: rfi.category || 'scope_clarification',
          priority: rfi.priority || 'normal',
          source: 'email',
          source_email_id: inboundEmailId,
          related_drawing_sheets: rfi.drawing_reference,
          related_spec_sections: rfi.spec_reference,
          status: 'open',
          date_submitted: new Date().toISOString().split('T')[0]
        })
        .select()
        .single()

      if (error) {
        console.error('Error saving RFI:', error)
      } else {
        results.push(data)
        console.log(`Saved RFI: ${data.rfi_number} - ${data.subject}`)
      }
    } catch (err) {
      console.error('Exception saving RFI:', err)
    }
  }

  return results
}

/**
 * Try to match a forwarded email to project/subcontractor using original sender info
 */
async function matchForwardedEmail(parsedBid, subject) {
  if (!supabase) return null

  const originalSender = parsedBid.original_sender
  const identifiedProject = parsedBid.identified_project
  const identifiedTrade = parsedBid.identified_trade

  let context = { project: null, subcontractor: null, invitedPackages: [] }

  // Try to match subcontractor by company name or email from original sender
  if (originalSender?.company_name || originalSender?.email) {
    const { data: subs } = await supabase
      .from('subcontractors')
      .select('id, company_name, email, contact_name')
      .or(`company_name.ilike.%${originalSender.company_name || ''}%,email.ilike.%${originalSender.email || ''}%`)
      .limit(1)

    if (subs?.[0]) {
      context.subcontractor = subs[0]
      console.log(`Matched forwarded email to subcontractor: ${subs[0].company_name}`)
    }
  }

  // Try to match project by name mentioned in email/PDF
  if (identifiedProject) {
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, project_number')
      .or(`name.ilike.%${identifiedProject}%,project_number.ilike.%${identifiedProject}%`)
      .eq('status', 'bidding')
      .limit(1)

    if (projects?.[0]) {
      context.project = projects[0]
      console.log(`Matched forwarded email to project: ${projects[0].name}`)
    }
  }

  // If we have a subcontractor but no project, look for recent invitations
  if (context.subcontractor && !context.project) {
    const { data: invitations } = await supabase
      .from('bid_invitations')
      .select(`
        id,
        project_id,
        projects:project_id (id, name)
      `)
      .eq('subcontractor_id', context.subcontractor.id)
      .order('sent_at', { ascending: false })
      .limit(5)

    // Try to match by project name in subject or identified trade
    for (const inv of invitations || []) {
      if (inv.projects?.name) {
        const projectNameLower = inv.projects.name.toLowerCase()
        if (subject?.toLowerCase().includes(projectNameLower) ||
            identifiedProject?.toLowerCase().includes(projectNameLower)) {
          context.project = inv.projects
          console.log(`Matched to project via invitation: ${inv.projects.name}`)
          break
        }
      }
    }

    // If still no match, use most recent invitation
    if (!context.project && invitations?.[0]?.projects) {
      context.project = invitations[0].projects
      console.log(`Using most recent invitation project: ${context.project.name}`)
    }
  }

  return context
}

/**
 * Save parsed bid response to database
 */
async function saveBidResponse(inboundEmail, parsedBid, context) {
  if (!supabase) {
    console.log('Supabase not initialized, skipping database save')
    return null
  }

  // First, save the inbound email
  const { data: emailRecord, error: emailError } = await supabase
    .from('inbound_emails')
    .insert({
      from_email: inboundEmail.from,
      from_name: inboundEmail.fromName,
      to_email: inboundEmail.to,
      subject: inboundEmail.subject,
      body_plain: inboundEmail.bodyPlain,
      body_html: inboundEmail.bodyHtml,
      attachments: inboundEmail.attachments.map(a => ({
        filename: a.filename,
        content_type: a.contentType,
        size: a.size
      })),
      processing_status: 'completed',
      matched_project_id: context?.project?.id,
      matched_subcontractor_id: context?.subcontractor?.id,
      email_date: new Date().toISOString(),
      processed_at: new Date().toISOString()
    })
    .select()
    .single()

  if (emailError) {
    console.error('Error saving inbound email:', emailError)
    return null
  }

  // Then save the parsed bid response
  const { data: bidResponse, error: bidError } = await supabase
    .from('bid_responses')
    .insert({
      inbound_email_id: emailRecord.id,
      project_id: context?.project?.id,
      subcontractor_id: context?.subcontractor?.id,
      total_amount: parsedBid.total_amount,
      line_items: parsedBid.line_items || [],
      scope_included: parsedBid.scope_included,
      scope_excluded: parsedBid.scope_excluded,
      clarifications: parsedBid.clarifications,
      alternates: parsedBid.alternates || [],
      payment_terms: parsedBid.payment_terms,
      lead_time: parsedBid.lead_time,
      valid_until: parsedBid.valid_until,
      warranty_info: parsedBid.warranty_info,
      ai_confidence_score: parsedBid.confidence_score,
      ai_analysis_notes: parsedBid.analysis_notes,
      raw_extracted_data: parsedBid,
      status: 'pending_review'
    })
    .select()
    .single()

  if (bidError) {
    console.error('Error saving bid response:', bidError)
    return emailRecord
  }

  // Update invitation status if we have a match
  if (context?.invitation?.id) {
    await supabase
      .from('bid_invitations')
      .update({
        status: 'replied',
        replied_at: new Date().toISOString()
      })
      .eq('id', context.invitation.id)
  }

  return { email: emailRecord, bidResponse }
}

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }

  // Health check
  if (event.httpMethod === 'GET') {
    initClients()
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        endpoint: 'process-bid-response',
        description: 'Webhook for SendGrid Inbound Parse - receives bid emails from subcontractors',
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        hasSupabase: !!process.env.VITE_SUPABASE_URL,
        model: CLAUDE_MODEL,
        setup_instructions: {
          step1: 'Configure MX records for your subdomain to point to SendGrid',
          step2: 'In SendGrid Inbound Parse settings, add this URL as the webhook',
          step3: 'Ensure ANTHROPIC_API_KEY and Supabase env vars are set'
        }
      })
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  initClients()

  if (!anthropic) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Anthropic API key not configured' })
    }
  }

  try {
    console.log('Received inbound email webhook...')

    // Parse the incoming email data
    const { fields, attachments } = await parseInboundEmail(event)

    // Debug: log all fields and their lengths
    console.log('Parsed email fields:', Object.keys(fields))
    for (const [key, value] of Object.entries(fields)) {
      const preview = typeof value === 'string' ? value.substring(0, 100) : JSON.stringify(value).substring(0, 100)
      console.log(`  Field "${key}": ${typeof value === 'string' ? value.length : 'object'} chars - "${preview}..."`)
    }
    console.log('Attachments count:', attachments.length)

    // Extract email details - check multiple possible field names
    const fromEmail = fields.from?.match(/<(.+)>/)?.[1] || fields.from || fields.sender || ''
    const fromName = fields.from?.replace(/<.+>/, '').trim() || ''
    const toEmail = fields.to || fields.recipient || ''
    const subject = fields.subject || ''

    // Try multiple body fields - SendGrid uses 'text' for plain and 'html' for HTML
    // Also check 'body', 'body-plain', 'body-html' as fallbacks
    const bodyPlain = fields.text || fields['body-plain'] || fields.body || ''
    const bodyHtml = fields.html || fields['body-html'] || ''

    // If raw MIME mode is enabled, body is in 'email' field
    let rawMimeBody = ''
    if (fields.email && (!bodyPlain && !bodyHtml)) {
      console.log('Raw MIME message detected, extracting body...')
      // Simple extraction from MIME - look for content after blank line
      const mimeLines = fields.email.split('\n')
      let inBody = false
      const bodyLines = []
      for (const line of mimeLines) {
        if (inBody) {
          bodyLines.push(line)
        } else if (line.trim() === '') {
          inBody = true
        }
      }
      rawMimeBody = bodyLines.join('\n').trim()
      console.log(`Extracted ${rawMimeBody.length} chars from raw MIME`)
    }

    const finalBody = bodyPlain || bodyHtml || rawMimeBody

    console.log(`From: ${fromEmail}`)
    console.log(`Subject: ${subject}`)
    console.log(`Body plain length: ${bodyPlain.length} chars`)
    console.log(`Body HTML length: ${bodyHtml.length} chars`)
    console.log(`Final body length: ${finalBody.length} chars`)
    if (finalBody) {
      console.log(`Body preview: "${finalBody.substring(0, 200)}..."`)
    }
    console.log(`Attachments: ${attachments.map(a => `${a.filename} (${a.contentType})`).join(', ') || 'none'}`)

    // Find matching project/subcontractor
    const context = await findMatchingContext(fromEmail, subject)
    console.log('Matched context:', {
      subcontractor: context?.subcontractor?.company_name,
      project: context?.project?.name,
      invitedPackages: context?.invitedPackages?.map(p => p.name || p),
      hasPendingClarification: !!context?.pendingClarification
    })

    // Analyze with AI - both body and attachments, pass packages for breakdown detection
    console.log('Starting AI analysis...')
    let parsedBid = await analyzeWithAI(finalBody, attachments, context?.invitedPackages || [])
    console.log('AI analysis complete:', {
      total: parsedBid.total_amount,
      isLumpSum: parsedBid.is_lump_sum,
      lineItems: parsedBid.line_items?.length || 0,
      confidence: parsedBid.confidence_score,
      isLumpSumForMultiple: parsedBid.is_lump_sum_for_multiple,
      hasPackageBreakdown: !!parsedBid.amounts_by_package && Object.keys(parsedBid.amounts_by_package).length > 0,
      isForwarded: parsedBid.is_forwarded_email,
      rfisFound: parsedBid.rfis?.length || 0,
      analysisNotes: parsedBid.analysis_notes
    })

    // Handle forwarded emails - try to match using original sender info
    let finalContext = context
    if (parsedBid.is_forwarded_email && (!context?.subcontractor || !context?.project)) {
      console.log('Forwarded email detected, attempting to match using original sender info...')
      const forwardedContext = await matchForwardedEmail(parsedBid, subject)
      if (forwardedContext?.subcontractor || forwardedContext?.project) {
        finalContext = {
          ...context,
          subcontractor: forwardedContext.subcontractor || context?.subcontractor,
          project: forwardedContext.project || context?.project,
          invitedPackages: context?.invitedPackages || []
        }
        console.log('Forwarded email matched:', {
          subcontractor: finalContext.subcontractor?.company_name,
          project: finalContext.project?.name
        })
      }
    }

    // Save to database first (so we have bid_response_id for package bids and RFIs)
    const savedData = await saveBidResponse(
      {
        from: fromEmail,
        fromName,
        to: toEmail,
        subject,
        bodyPlain,
        bodyHtml,
        attachments
      },
      parsedBid,
      finalContext
    )
    const bidResponseId = savedData?.bidResponse?.id
    const inboundEmailId = savedData?.email?.id

    // Save any RFIs that were extracted from the email
    let savedRfis = null
    if (parsedBid.rfis && parsedBid.rfis.length > 0) {
      console.log(`Found ${parsedBid.rfis.length} RFIs in email, saving...`)
      savedRfis = await saveRFIs(parsedBid.rfis, finalContext, inboundEmailId)
      console.log('Saved RFIs:', savedRfis?.map(r => r.rfi_number))
    }

    // Check if this is a clarification response with per-package breakdown
    let perPackageBidsCreated = null
    const invitedPackages = finalContext?.invitedPackages || []

    if (parsedBid.amounts_by_package && Object.keys(parsedBid.amounts_by_package).length > 0) {
      // We have per-package amounts - save them to package_bids table
      console.log('Processing bid with per-package breakdown...')
      perPackageBidsCreated = await savePerPackageBids(finalContext, parsedBid, bidResponseId)
      console.log('Per-package bids created:', perPackageBidsCreated)
    } else if (invitedPackages.length === 1 && parsedBid.total_amount) {
      // Single package invitation with lump sum - auto-create package bid
      console.log('Single package bid detected - creating package bid...')
      const singlePackageBid = {
        ...parsedBid,
        amounts_by_package: {
          [invitedPackages[0].name]: parsedBid.total_amount
        }
      }
      perPackageBidsCreated = await savePerPackageBids(finalContext, singlePackageBid, bidResponseId)
      console.log('Single package bid created:', perPackageBidsCreated)
    }

    // Check if we need to send a clarification request
    // Only if: multiple packages, single lump sum, no breakdown provided, no pending clarification
    let clarificationSent = null
    // Detect if this is a lump sum needing clarification:
    // - Multiple packages were invited
    // - Got a total amount
    // - Either is_lump_sum_for_multiple is true OR (is_lump_sum is true with no per-package breakdown)
    // - No pending clarification already sent
    const isLumpSumWithoutBreakdown = (
      parsedBid.is_lump_sum_for_multiple ||
      (parsedBid.is_lump_sum && (!parsedBid.amounts_by_package || Object.keys(parsedBid.amounts_by_package).length === 0))
    )
    const needsClarification = (
      invitedPackages.length > 1 &&
      parsedBid.total_amount &&
      isLumpSumWithoutBreakdown &&
      !finalContext?.pendingClarification
    )

    if (needsClarification) {
      console.log('Detected lump sum bid for multiple packages - sending clarification request...')
      clarificationSent = await sendClarificationEmail(finalContext, parsedBid)
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Bid response processed successfully',
        from: fromEmail,
        subject: subject,
        matched: {
          subcontractor: finalContext?.subcontractor?.company_name || null,
          project: finalContext?.project?.name || null,
          packages_count: invitedPackages.length,
          matched_via_forwarded: parsedBid.is_forwarded_email && (!context?.subcontractor || !context?.project)
        },
        extracted: {
          total_amount: parsedBid.total_amount,
          is_lump_sum: parsedBid.is_lump_sum,
          line_items_count: parsedBid.line_items?.length || 0,
          has_exclusions: !!parsedBid.scope_excluded,
          has_clarifications: !!parsedBid.clarifications,
          confidence_score: parsedBid.confidence_score,
          is_lump_sum_for_multiple: parsedBid.is_lump_sum_for_multiple,
          amounts_by_package: parsedBid.amounts_by_package || null,
          is_forwarded_email: parsedBid.is_forwarded_email,
          original_sender: parsedBid.original_sender,
          identified_project: parsedBid.identified_project,
          identified_trade: parsedBid.identified_trade,
          analysis_notes: parsedBid.analysis_notes
        },
        rfis: {
          found_count: parsedBid.rfis?.length || 0,
          saved: savedRfis?.map(r => ({ number: r.rfi_number, subject: r.subject })) || []
        },
        saved: !!savedData,
        clarification_workflow: {
          was_clarification_response: !!finalContext?.pendingClarification,
          per_package_bids_created: perPackageBidsCreated,
          clarification_sent: clarificationSent
        }
      })
    }

  } catch (error) {
    console.error('Error processing bid response:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process bid response',
        details: error.message
      })
    }
  }
}
