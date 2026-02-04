/**
 * SendGrid email service for requesting bid clarification
 * Used when a subcontractor provides a lump sum for multiple packages
 */

import { createClient } from '@supabase/supabase-js'

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send'

function getSupabase() {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    )
  }
  return null
}

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '{}' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'SendGrid API key not configured' })
    }
  }

  try {
    const {
      to_email,
      to_name,
      company_name,
      project_name,
      project_id,
      subcontractor_id,
      packages,          // Array of package names that need breakdown
      lump_sum_amount,   // The total amount they provided
      original_bid_id,   // Reference to the original bid
      sender_name,
      sender_company,
      sender_email,
      sender_phone
    } = JSON.parse(event.body)

    if (!to_email || !project_name || !packages?.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: to_email, project_name, packages' })
      }
    }

    const formattedAmount = lump_sum_amount
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(lump_sum_amount)
      : 'the amount provided'

    // Build packages list HTML
    const packagesListHtml = packages.map((pkg, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#f9f9f9' : 'white'};">
        <td style="padding: 12px; border: 1px solid #ddd;">${pkg}</td>
        <td style="padding: 12px; border: 1px solid #ddd; text-align: right;">$_____________</td>
      </tr>
    `).join('')

    const packagesListText = packages.map(pkg => `  - ${pkg}: $_____________`).join('\n')

    const subject = `Clarification Needed: Pricing Breakdown for ${project_name}`

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

          <p>
            ${sender_name ? `<strong>${sender_name}</strong><br>` : ''}
            ${sender_company ? `${sender_company}<br>` : ''}
            ${sender_email ? `Email: <a href="mailto:${sender_email}">${sender_email}</a><br>` : ''}
            ${sender_phone ? `Phone: ${sender_phone}` : ''}
          </p>

          <p>Thank you for your cooperation.</p>

          <p>Best regards,<br>
          ${sender_name || sender_company || 'The Project Team'}</p>
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

${sender_name || ''}
${sender_company || ''}
${sender_email ? `Email: ${sender_email}` : ''}
${sender_phone ? `Phone: ${sender_phone}` : ''}

Thank you for your cooperation.

Best regards,
${sender_name || sender_company || 'The Project Team'}
    `.trim()

    const sendGridPayload = {
      personalizations: [{
        to: [{ email: to_email, name: to_name || company_name }],
        subject: subject
      }],
      from: {
        email: sender_email || process.env.SENDGRID_FROM_EMAIL || 'noreply@bidcoordinator.com',
        name: sender_name || sender_company || 'BidCoordinator'
      },
      reply_to: process.env.SENDGRID_INBOUND_EMAIL
        ? { email: process.env.SENDGRID_INBOUND_EMAIL, name: sender_name || sender_company || 'Clipper Construction Bids' }
        : sender_email
          ? { email: sender_email, name: sender_name }
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
      throw new Error(`SendGrid API error: ${response.status}`)
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
            original_bid_id,
            packages_requested: packages,
            lump_sum_amount,
            status: 'pending',
            sent_at: new Date().toISOString()
          })
      } catch (trackError) {
        console.warn('Error tracking clarification request:', trackError.message)
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Clarification request sent successfully',
        packages_requested: packages
      })
    }

  } catch (error) {
    console.error('Error sending clarification request:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to send clarification request', details: error.message })
    }
  }
}
