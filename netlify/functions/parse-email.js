import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

function getSupabase() {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    )
  }
  return null
}

// Helper to send clarification request email
async function sendClarificationEmail({ to_email, to_name, company_name, project_name, project_id, subcontractor_id, packages, lump_sum_amount }) {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) {
    console.warn('SendGrid API key not configured - cannot send clarification email')
    return { success: false, error: 'SendGrid not configured' }
  }

  const formattedAmount = lump_sum_amount
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(lump_sum_amount)
    : 'the amount provided'

  const packagesListHtml = packages.map((pkg, i) => `
    <tr style="background-color: ${i % 2 === 0 ? '#f9f9f9' : 'white'};">
      <td style="padding: 12px; border: 1px solid #ddd;">${pkg}</td>
      <td style="padding: 12px; border: 1px solid #ddd; text-align: right;">$_____________</td>
    </tr>
  `).join('')

  const packagesListText = packages.map(pkg => `  - ${pkg}: $_____________`).join('\n')

  const subject = `Clarification Needed: Pricing Breakdown for ${project_name}`
  const senderCompany = 'Clipper Construction'

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
        <p>Dear ${to_name || company_name || 'Contractor'},</p>

        <p>Thank you for submitting your bid for <strong>${project_name}</strong>.</p>

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
        ${senderCompany}</p>
      </div>

      <div class="footer">
        <p>This clarification request was sent via BidCoordinator</p>
      </div>
    </body>
    </html>
  `

  const textContent = `
PRICING CLARIFICATION REQUEST

Dear ${to_name || company_name || 'Contractor'},

Thank you for submitting your bid for ${project_name}.

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

If you have any questions or need clarification on the package scope, please don't hesitate to reach out.

Thank you for your cooperation.

Best regards,
${senderCompany}
  `.trim()

  const sendGridPayload = {
    personalizations: [{
      to: [{ email: to_email, name: to_name || company_name }],
      subject: subject
    }],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@bidcoordinator.com',
      name: senderCompany
    },
    reply_to: process.env.SENDGRID_INBOUND_EMAIL
      ? { email: process.env.SENDGRID_INBOUND_EMAIL, name: senderCompany }
      : undefined,
    content: [
      { type: 'text/plain', value: textContent },
      { type: 'text/html', value: htmlContent }
    ],
    tracking_settings: {
      click_tracking: { enable: true },
      open_tracking: { enable: true }
    }
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
      console.error('SendGrid error:', errorText)
      return { success: false, error: `SendGrid API error: ${response.status}` }
    }

    // Track the clarification request in database
    const supabase = getSupabase()
    if (supabase && project_id && subcontractor_id) {
      try {
        await supabase
          .from('bid_clarifications')
          .insert({
            project_id,
            subcontractor_id,
            packages_requested: packages,
            lump_sum_amount,
            status: 'pending',
            sent_at: new Date().toISOString()
          })
      } catch (trackError) {
        console.warn('Error tracking clarification request:', trackError.message)
      }
    }

    console.log(`Clarification email sent to ${to_email} for packages: ${packages.join(', ')}`)
    return { success: true }
  } catch (error) {
    console.error('Error sending clarification email:', error)
    return { success: false, error: error.message }
  }
}

export async function handler(event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    const { email_content, project_id, subcontractor_id, invited_packages } = JSON.parse(event.body)

    if (!email_content) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'email_content is required' })
      }
    }

    // Build context about what packages were invited (if provided)
    const packageContext = invited_packages?.length > 0
      ? `\n\nIMPORTANT CONTEXT: This subcontractor was invited to bid on these SEPARATE packages: ${invited_packages.join(', ')}.

CRITICAL: Look carefully for per-package pricing breakdown. If they list prices like:
- "Electrical: $50,000" or "Electrical - $50,000"
- "Fire Alarm: $25,000"
- "Low Voltage: $15,000"
Then extract these into amounts_by_package.

If they only give ONE total/lump sum without breaking down by package, then needs_clarification should be true.`
      : ''

    // Use Anthropic Claude to parse the email
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Parse this contractor bid email and extract pricing information. Return ONLY a valid JSON object.

CRITICAL: If the email contains per-package pricing (like "Electrical: $50,000, Fire Alarm: $25,000"), you MUST extract each into amounts_by_package. This is often a response to a clarification request.

{
  "bid_data": {
    "amount": <number or null - total bid amount>,
    "amounts_by_package": <object or null - IMPORTANT: extract any per-package pricing, e.g. {"Electrical": 50000, "Fire Alarm": 25000, "Low Voltage": 15000}>,
    "includes": <string or null>,
    "excludes": <string or null>,
    "clarifications": <string or null>,
    "lead_time": <string or null>,
    "valid_until": <string or null>
  },
  "sender_info": {
    "company_name": <string or null>,
    "contact_name": <string or null>,
    "email": <string or null>,
    "phone": <string or null>
  },
  "needs_clarification": <boolean - true ONLY if they gave a single lump sum for multiple packages WITHOUT any breakdown>,
  "clarification_reason": <string or null>,
  "confidence": <number 0-1>
}
${packageContext}

Email content:
${email_content.substring(0, 4000)}`
        }
      ]
    })

    // Extract the JSON from the response
    let parsedData
    try {
      const responseText = message.content[0].text
      // Try to find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (parseError) {
      console.error('Error parsing Claude response:', parseError)
      // Fallback to rule-based extraction
      parsedData = extractWithRules(email_content, invited_packages)
    }

    // Double-check for multi-package lump sum situation
    if (invited_packages?.length > 1 && parsedData.bid_data?.amount && !parsedData.bid_data?.amounts_by_package) {
      parsedData.needs_clarification = true
      parsedData.clarification_reason = parsedData.clarification_reason ||
        `Lump sum of $${parsedData.bid_data.amount.toLocaleString()} provided for ${invited_packages.length} packages (${invited_packages.join(', ')}). Need breakdown by package.`
      parsedData.packages_needing_breakdown = invited_packages
    }

    // Add suggested matches placeholder
    parsedData.suggested_matches = {
      subcontractor: subcontractor_id ? { id: subcontractor_id } : null,
      project: project_id ? { id: project_id } : null,
      bid_items: []
    }

    // If we have package breakdown (clarification response), process and save the bids
    if (parsedData.bid_data?.amounts_by_package && Object.keys(parsedData.bid_data.amounts_by_package).length > 0 && subcontractor_id && project_id) {
      const supabase = getSupabase()
      if (supabase) {
        try {
          // Mark any pending clarification as resolved
          await supabase
            .from('bid_clarifications')
            .update({
              status: 'resolved',
              responded_at: new Date().toISOString(),
              package_amounts: parsedData.bid_data.amounts_by_package
            })
            .eq('project_id', project_id)
            .eq('subcontractor_id', subcontractor_id)
            .eq('status', 'pending')

          // Get scope packages for this project to match package names to bid items
          const { data: scopePackages } = await supabase
            .from('scope_packages')
            .select(`
              id, name,
              items:scope_package_items(bid_item_id)
            `)
            .eq('project_id', project_id)

          // Create/update bids for each package amount
          const createdBids = []
          for (const [packageName, amount] of Object.entries(parsedData.bid_data.amounts_by_package)) {
            // Find matching scope package (case-insensitive)
            const matchingPackage = scopePackages?.find(pkg =>
              pkg.name?.toLowerCase() === packageName.toLowerCase() ||
              pkg.name?.toLowerCase().includes(packageName.toLowerCase()) ||
              packageName.toLowerCase().includes(pkg.name?.toLowerCase())
            )

            if (matchingPackage && matchingPackage.items?.length > 0) {
              // Create a bid for the first bid_item in this package (package-level bid)
              const bidItemId = matchingPackage.items[0].bid_item_id

              // Check if bid already exists
              const { data: existingBid } = await supabase
                .from('bids')
                .select('id')
                .eq('bid_item_id', bidItemId)
                .eq('subcontractor_id', subcontractor_id)
                .single()

              if (existingBid) {
                // Update existing bid
                await supabase
                  .from('bids')
                  .update({
                    amount: amount,
                    status: 'submitted',
                    submitted_at: new Date().toISOString(),
                    notes: `Package bid for ${packageName} (from clarification response)`
                  })
                  .eq('id', existingBid.id)

                createdBids.push({ package: packageName, amount, action: 'updated', bid_item_id: bidItemId })
              } else {
                // Create new bid
                await supabase
                  .from('bids')
                  .insert({
                    bid_item_id: bidItemId,
                    subcontractor_id: subcontractor_id,
                    amount: amount,
                    status: 'submitted',
                    submitted_at: new Date().toISOString(),
                    notes: `Package bid for ${packageName} (from clarification response)`
                  })

                createdBids.push({ package: packageName, amount, action: 'created', bid_item_id: bidItemId })
              }
            } else {
              createdBids.push({ package: packageName, amount, action: 'no_match', error: 'Could not find matching scope package' })
            }
          }

          parsedData.clarification_response_processed = true
          parsedData.bids_created = createdBids
          parsedData.needs_clarification = false // They provided the breakdown

          console.log(`Processed clarification response: ${createdBids.length} packages`)
        } catch (e) {
          console.error('Error processing clarification response:', e)
          parsedData.clarification_response_error = e.message
        }
      }
    }

    // If clarification needed, fetch subcontractor/project info and auto-send clarification email
    if (parsedData.needs_clarification && subcontractor_id && project_id) {
      const supabase = getSupabase()
      if (supabase) {
        try {
          // Fetch subcontractor info
          const { data: sub } = await supabase
            .from('subcontractors')
            .select('id, company_name, contact_name, email')
            .eq('id', subcontractor_id)
            .single()

          // Fetch project info
          const { data: project } = await supabase
            .from('projects')
            .select('id, name')
            .eq('id', project_id)
            .single()

          if (sub) {
            parsedData.subcontractor_for_clarification = sub
          }

          // Auto-send clarification email if we have all required info
          if (sub?.email && project?.name && parsedData.packages_needing_breakdown?.length > 0) {
            const emailResult = await sendClarificationEmail({
              to_email: sub.email,
              to_name: sub.contact_name,
              company_name: sub.company_name,
              project_name: project.name,
              project_id: project_id,
              subcontractor_id: subcontractor_id,
              packages: parsedData.packages_needing_breakdown,
              lump_sum_amount: parsedData.bid_data?.amount
            })

            parsedData.clarification_email_sent = emailResult.success
            if (emailResult.success) {
              parsedData.clarification_email_message = `Clarification request automatically sent to ${sub.email}`
            } else {
              parsedData.clarification_email_error = emailResult.error
            }
          }
        } catch (e) {
          console.warn('Could not fetch subcontractor/project:', e.message)
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(parsedData)
    }
  } catch (error) {
    console.error('Error in parse-email function:', error)

    // If Anthropic fails, fall back to rule-based extraction
    try {
      const { email_content, invited_packages } = JSON.parse(event.body)
      const fallbackData = extractWithRules(email_content, invited_packages)

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fallbackData)
      }
    } catch (fallbackError) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to parse email' })
      }
    }
  }
}

function extractWithRules(emailContent, invitedPackages = []) {
  const bidData = {
    amount: null,
    amounts_by_package: null,
    includes: null,
    excludes: null,
    clarifications: null,
    lead_time: null,
    valid_until: null
  }

  const senderInfo = {
    company_name: null,
    contact_name: null,
    email: null,
    phone: null
  }

  // Extract amount
  const amountPatterns = [
    /\$\s*([\d,]+(?:\.\d{2})?)/gi,
    /(?:total|bid|price|amount|quote)[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/gi
  ]

  const amounts = []
  for (const pattern of amountPatterns) {
    const matches = emailContent.matchAll(pattern)
    for (const match of matches) {
      const amount = parseFloat(match[1].replace(/,/g, ''))
      if (amount > 100) {
        amounts.push(amount)
      }
    }
  }

  if (amounts.length > 0) {
    bidData.amount = Math.max(...amounts)
  }

  // Extract email
  const emailMatch = emailContent.match(/From:\s*(?:"?([^"<]+)"?\s*)?<?([^>\s]+@[^>\s]+)>?/i)
  if (emailMatch) {
    senderInfo.contact_name = emailMatch[1]?.trim() || null
    senderInfo.email = emailMatch[2]?.trim() || null
  }

  // Extract phone
  const phoneMatch = emailContent.match(/(?:phone|tel|cell|mobile)[:\s]*([(\d\s\-)+.]{10,})/i)
  if (phoneMatch) {
    senderInfo.phone = phoneMatch[1].replace(/[^\d]/g, '').substring(0, 10)
  }

  // Extract company name from signature or email domain
  const companyPatterns = [
    /(?:^|\n)([A-Z][A-Za-z\s&]+(?:Inc\.|LLC|Corp\.|Co\.|Construction|Electric|Plumbing|Mechanical|HVAC))/,
    /(?:company|contractor)[:\s]*([A-Za-z\s&]+(?:Inc\.|LLC|Corp\.|Co\.))/i
  ]

  for (const pattern of companyPatterns) {
    const match = emailContent.match(pattern)
    if (match) {
      senderInfo.company_name = match[1].trim()
      break
    }
  }

  // Extract includes
  const includesMatch = emailContent.match(/(?:includes?|including|incl\.?|scope)[:\s]*([^\n]+(?:\n[-•*]\s*[^\n]+)*)/i)
  if (includesMatch) {
    bidData.includes = includesMatch[1].trim()
  }

  // Extract excludes
  const excludesMatch = emailContent.match(/(?:excludes?|excluding|excl\.?|not included|does not include)[:\s]*([^\n]+(?:\n[-•*]\s*[^\n]+)*)/i)
  if (excludesMatch) {
    bidData.excludes = excludesMatch[1].trim()
  }

  // Extract lead time
  const leadTimeMatch = emailContent.match(/(?:lead time|delivery|ship)[:\s]*([\d]+\s*(?:days?|weeks?|months?))/i)
  if (leadTimeMatch) {
    bidData.lead_time = leadTimeMatch[1].trim()
  }

  // Calculate confidence
  let confidence = 0.3
  if (bidData.amount) confidence += 0.3
  if (senderInfo.email) confidence += 0.1
  if (senderInfo.company_name) confidence += 0.1
  if (bidData.includes || bidData.excludes) confidence += 0.1

  // Check if clarification needed for multi-package lump sum
  let needsClarification = false
  let clarificationReason = null
  let packagesNeedingBreakdown = null

  if (invitedPackages.length > 1 && bidData.amount && !bidData.amounts_by_package) {
    needsClarification = true
    clarificationReason = `Lump sum of $${bidData.amount.toLocaleString()} provided for ${invitedPackages.length} packages (${invitedPackages.join(', ')}). Need breakdown by package.`
    packagesNeedingBreakdown = invitedPackages
  }

  return {
    bid_data: bidData,
    sender_info: senderInfo,
    confidence: Math.min(confidence, 0.9),
    needs_clarification: needsClarification,
    clarification_reason: clarificationReason,
    packages_needing_breakdown: packagesNeedingBreakdown,
    suggested_matches: {
      subcontractor: null,
      project: null,
      bid_items: []
    }
  }
}
