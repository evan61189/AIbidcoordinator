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

Return JSON only:
{
  "total_amount": number or null,
  "amounts_by_package": ${packageNames.length > 1 ? `{ "${packageNames.join('": number, "')}" : number } or null if only lump sum provided` : 'null'},
  "is_lump_sum_for_multiple": ${packageNames.length > 1 ? 'true if single lump sum covers multiple packages without breakdown, false if breakdown provided' : 'false'},
  "line_items": [
    {
      "description": "Item description",
      "quantity": "Qty or null",
      "unit": "Unit or null",
      "unit_price": number or null,
      "total": number or null,
      "trade": "Trade/division name"
    }
  ],
  "scope_included": "What is included in the bid",
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
  "confidence_score": 0.0 to 1.0,
  "analysis_notes": "Any important notes about the extraction"
}`
  })

  console.log(`Calling Claude AI with ${content.length} content blocks...`)
  const startTime = Date.now()

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: `You are an expert construction bid analyst. Extract pricing and scope information from subcontractor bid responses.
Be thorough - analyze BOTH the email body AND any attached documents.
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
 * Save per-package bids from a clarification response
 */
async function savePerPackageBids(context, parsedBid) {
  if (!supabase) return null

  const { subcontractor, project, invitedPackages, pendingClarification } = context
  const { amounts_by_package } = parsedBid

  if (!amounts_by_package || Object.keys(amounts_by_package).length === 0) {
    return null
  }

  const results = []

  for (const [packageName, amount] of Object.entries(amounts_by_package)) {
    // Find the package
    const pkg = invitedPackages.find(p =>
      (p.name || p).toLowerCase() === packageName.toLowerCase()
    )

    if (!pkg) {
      console.log(`Package not found for: ${packageName}`)
      continue
    }

    // Get bid items for this package
    const { data: packageItems } = await supabase
      .from('scope_package_items')
      .select('bid_item_id')
      .eq('scope_package_id', pkg.id)

    if (!packageItems?.length) {
      console.log(`No items found for package: ${packageName}`)
      continue
    }

    // Create a bid for the package (using first item as representative)
    const { data: bid, error } = await supabase
      .from('bids')
      .insert({
        bid_item_id: packageItems[0].bid_item_id,
        subcontractor_id: subcontractor.id,
        amount: amount,
        status: 'submitted',
        notes: `Package bid for ${packageName} (from clarification response)`,
        submitted_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error(`Error creating bid for ${packageName}:`, error)
    } else {
      results.push({ package: packageName, bid_id: bid.id, amount })
      console.log(`Created bid for ${packageName}: $${amount}`)
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
    const parsedBid = await analyzeWithAI(finalBody, attachments, context?.invitedPackages || [])
    console.log('AI analysis complete:', {
      total: parsedBid.total_amount,
      lineItems: parsedBid.line_items?.length || 0,
      confidence: parsedBid.confidence_score,
      isLumpSum: parsedBid.is_lump_sum_for_multiple,
      hasPackageBreakdown: !!parsedBid.amounts_by_package && Object.keys(parsedBid.amounts_by_package).length > 0
    })

    // Check if this is a clarification response with per-package breakdown
    let perPackageBidsCreated = null
    if (context?.pendingClarification && parsedBid.amounts_by_package && Object.keys(parsedBid.amounts_by_package).length > 0) {
      console.log('Processing clarification response with per-package breakdown...')
      perPackageBidsCreated = await savePerPackageBids(context, parsedBid)
      console.log('Per-package bids created:', perPackageBidsCreated)
    }

    // Save to database
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
      context
    )

    // Check if we need to send a clarification request
    // Only if: multiple packages, single lump sum, no breakdown provided, no pending clarification
    let clarificationSent = null
    const invitedPackages = context?.invitedPackages || []
    const needsClarification = (
      invitedPackages.length > 1 &&
      parsedBid.total_amount &&
      parsedBid.is_lump_sum_for_multiple &&
      !parsedBid.amounts_by_package &&
      !context?.pendingClarification
    )

    if (needsClarification) {
      console.log('Detected lump sum bid for multiple packages - sending clarification request...')
      clarificationSent = await sendClarificationEmail(context, parsedBid)
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
          subcontractor: context?.subcontractor?.company_name || null,
          project: context?.project?.name || null,
          packages_count: invitedPackages.length
        },
        extracted: {
          total_amount: parsedBid.total_amount,
          line_items_count: parsedBid.line_items?.length || 0,
          has_exclusions: !!parsedBid.scope_excluded,
          has_clarifications: !!parsedBid.clarifications,
          confidence_score: parsedBid.confidence_score,
          is_lump_sum_for_multiple: parsedBid.is_lump_sum_for_multiple,
          amounts_by_package: parsedBid.amounts_by_package || null
        },
        saved: !!savedData,
        clarification_workflow: {
          was_clarification_response: !!context?.pendingClarification,
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
