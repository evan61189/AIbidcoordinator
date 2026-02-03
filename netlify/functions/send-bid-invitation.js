/**
 * SendGrid email service for sending bid invitations
 * Also tracks invitations in database for reply matching
 */

import { createClient } from '@supabase/supabase-js'

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send'

// Initialize Supabase client
function getSupabase() {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    )
  }
  return null
}

// Standard disclaimer for all bid communications
export const BID_DISCLAIMER = `
IMPORTANT NOTICE TO BIDDERS:

This invitation to bid and any accompanying schedule of values, scope descriptions, or bid items are provided for convenience only and do not represent the complete scope of work.

BY SUBMITTING A BID, THE SUBCONTRACTOR ACKNOWLEDGES AND AGREES THAT:

1. They have received, reviewed, and are fully familiar with the complete set of contract documents, including but not limited to all drawings, specifications, addenda, and general conditions.

2. Their bid includes ALL labor, materials, equipment, and services required to complete the work shown or implied in the contract documents, whether or not specifically itemized in the bid request.

3. The schedule of values or bid items listed are for organizational purposes only and do not limit or define the full scope of work required under the contract documents.

4. Any items shown in the drawings or specifications but not specifically listed in the bid items are included in the subcontractor's bid price.

5. The subcontractor has conducted their own independent takeoff and quantity verification from the contract documents.

6. Failure to include any required scope shall not be grounds for additional compensation.

This disclaimer shall be incorporated by reference into any resulting subcontract agreement.
`.trim()

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  // Health check endpoint
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        hasApiKey: !!process.env.SENDGRID_API_KEY,
        hasFromEmail: !!process.env.SENDGRID_FROM_EMAIL,
        fromEmail: process.env.SENDGRID_FROM_EMAIL ? '***configured***' : 'NOT SET'
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

  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'SendGrid API key not configured. Add SENDGRID_API_KEY to Netlify environment variables.' })
    }
  }

  try {
    const {
      to_email,
      to_name,
      subject,
      project_name,
      project_location,
      bid_due_date,
      bid_items,
      sender_name,
      sender_company,
      sender_email,
      sender_phone,
      custom_message,
      // Tracking fields for reply matching
      project_id,
      subcontractor_id,
      bid_item_ids,
      // Drawing attachments
      drawing_ids,
      bid_round_id,
      include_drawing_links
    } = JSON.parse(event.body)

    if (!to_email || !subject || !project_name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: to_email, subject, project_name' })
      }
    }

    // Build bid items table
    const bidItemsHtml = bid_items && bid_items.length > 0
      ? `
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background-color: #2c3e50; color: white;">
              <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Trade</th>
              <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Description</th>
              <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Quantity</th>
            </tr>
          </thead>
          <tbody>
            ${bid_items.map((item, index) => `
              <tr style="background-color: ${index % 2 === 0 ? '#f9f9f9' : 'white'};">
                <td style="padding: 10px; border: 1px solid #ddd;">${item.trade || ''}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">${item.description || ''}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">${item.quantity || ''} ${item.unit || ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
      : ''

    // Format disclaimer for HTML
    const disclaimerHtml = BID_DISCLAIMER.split('\n').map(line => {
      if (line.startsWith('IMPORTANT') || line.startsWith('BY SUBMITTING')) {
        return `<p style="font-weight: bold; margin-top: 15px;">${line}</p>`
      } else if (line.match(/^\d+\./)) {
        return `<p style="margin-left: 20px; margin-bottom: 8px;">${line}</p>`
      } else if (line.trim()) {
        return `<p>${line}</p>`
      }
      return ''
    }).join('')

    // Fetch drawings if drawing_ids provided
    let drawings = []
    let drawingLinks = []
    let attachments = []
    const supabase = getSupabase()

    if (supabase && (drawing_ids?.length > 0 || bid_round_id)) {
      try {
        let query = supabase
          .from('drawings')
          .select('id, original_filename, storage_url, file_size, discipline, drawing_number, title')

        if (drawing_ids?.length > 0) {
          query = query.in('id', drawing_ids)
        } else if (bid_round_id) {
          query = query.eq('bid_round_id', bid_round_id).eq('is_current', true)
        }

        const { data: drawingData } = await query
        drawings = drawingData || []

        // Calculate total size - SendGrid limit is ~30MB for attachments
        const totalSize = drawings.reduce((sum, d) => sum + (d.file_size || 0), 0)
        const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024 // 25MB to be safe

        if (totalSize > MAX_ATTACHMENT_SIZE || include_drawing_links) {
          // Too large for attachments - use download links instead
          drawingLinks = drawings.map(d => ({
            name: d.original_filename || `${d.drawing_number} - ${d.title}`,
            url: d.storage_url,
            discipline: d.discipline
          }))
        } else {
          // Fetch files and create attachments
          for (const drawing of drawings) {
            if (drawing.storage_url) {
              try {
                const response = await fetch(drawing.storage_url)
                if (response.ok) {
                  const buffer = await response.arrayBuffer()
                  const base64 = Buffer.from(buffer).toString('base64')
                  const filename = drawing.original_filename || `${drawing.drawing_number || 'drawing'}.pdf`

                  attachments.push({
                    content: base64,
                    filename: filename,
                    type: filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
                    disposition: 'attachment'
                  })
                }
              } catch (fetchError) {
                console.warn(`Failed to fetch drawing ${drawing.id}:`, fetchError.message)
                // Fall back to link
                drawingLinks.push({
                  name: drawing.original_filename || `${drawing.drawing_number} - ${drawing.title}`,
                  url: drawing.storage_url,
                  discipline: drawing.discipline
                })
              }
            }
          }
        }
      } catch (drawingError) {
        console.warn('Error fetching drawings:', drawingError.message)
      }
    }

    // Build drawing links HTML if we have links
    const drawingLinksHtml = drawingLinks.length > 0 ? `
      <h3>Project Drawings</h3>
      <p>Please download and review the following drawings for your bid:</p>
      <ul style="list-style-type: none; padding: 0;">
        ${drawingLinks.map(d => `
          <li style="margin: 8px 0; padding: 10px; background-color: #f8f9fa; border-radius: 4px;">
            <a href="${d.url}" style="color: #2c3e50; text-decoration: none; font-weight: bold;">
              📄 ${d.name}
            </a>
            ${d.discipline ? `<span style="color: #666; font-size: 12px;"> (${d.discipline})</span>` : ''}
          </li>
        `).join('')}
      </ul>
    ` : ''

    const drawingLinksText = drawingLinks.length > 0 ? `
PROJECT DRAWINGS:
${drawingLinks.map(d => `- ${d.name}: ${d.url}`).join('\n')}
` : ''

    // HTML email content - must be after drawingLinksHtml is defined
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
          .header { background-color: #2c3e50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .project-info { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .disclaimer { background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; margin-top: 30px; font-size: 12px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #ddd; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Invitation to Bid</h1>
        </div>

        <div class="content">
          <p>Dear ${to_name || 'Contractor'},</p>

          <p>${sender_company ? `${sender_company} is` : 'We are'} pleased to invite you to submit a bid for the following project:</p>

          <div class="project-info">
            <h2 style="margin-top: 0; color: #2c3e50;">${project_name}</h2>
            ${project_location ? `<p><strong>Location:</strong> ${project_location}</p>` : ''}
            ${bid_due_date ? `<p><strong>Bid Due Date:</strong> ${bid_due_date}</p>` : ''}
          </div>

          ${custom_message ? `<p>${custom_message}</p>` : ''}

          ${drawingLinksHtml}

          ${bid_items && bid_items.length > 0 ? `
            <h3>Scope of Work</h3>
            <p>Please provide pricing for the following items:</p>
            ${bidItemsHtml}
          ` : ''}

          ${attachments.length > 0 ? `
            <p style="color: #28a745; font-weight: bold;">📎 ${attachments.length} drawing file(s) attached to this email</p>
          ` : ''}

          <h3>Bid Submission Requirements</h3>
          <p>Your bid should include:</p>
          <ul>
            <li>Total lump sum price for the scope described</li>
            <li>Itemized breakdown by trade/division</li>
            <li>List of inclusions and exclusions</li>
            <li>Lead time / delivery schedule</li>
            <li>Any clarifications, assumptions, or alternates</li>
            <li>Bid validity period</li>
          </ul>

          <p>Please submit your bid by <strong>${bid_due_date || 'the specified due date'}</strong>.</p>

          <div class="disclaimer">
            <h4 style="margin-top: 0; color: #856404;">NOTICE TO BIDDERS</h4>
            ${disclaimerHtml}
          </div>

          <p style="margin-top: 30px;">If you have any questions, please contact:</p>
          <p>
            ${sender_name ? `<strong>${sender_name}</strong><br>` : ''}
            ${sender_company ? `${sender_company}<br>` : ''}
            ${sender_email ? `Email: <a href="mailto:${sender_email}">${sender_email}</a><br>` : ''}
            ${sender_phone ? `Phone: ${sender_phone}` : ''}
          </p>

          <p>Thank you for your interest in this project.</p>

          <p>Best regards,<br>
          ${sender_name || 'The Project Team'}</p>
        </div>

        <div class="footer">
          <p>This invitation was sent via BidCoordinator</p>
        </div>
      </body>
      </html>
    `

    // Plain text version
    const textContent = `
INVITATION TO BID

Dear ${to_name || 'Contractor'},

${sender_company ? `${sender_company} is` : 'We are'} pleased to invite you to submit a bid for the following project:

PROJECT: ${project_name}
${project_location ? `LOCATION: ${project_location}` : ''}
${bid_due_date ? `BID DUE DATE: ${bid_due_date}` : ''}

${custom_message || ''}
${drawingLinksText}
${bid_items && bid_items.length > 0 ? `
SCOPE OF WORK:
${bid_items.map(item => `- ${item.trade}: ${item.description} ${item.quantity ? `(${item.quantity} ${item.unit || ''})` : ''}`).join('\n')}
` : ''}

BID SUBMISSION REQUIREMENTS:
- Total lump sum price for the scope described
- Itemized breakdown by trade/division
- List of inclusions and exclusions
- Lead time / delivery schedule
- Any clarifications, assumptions, or alternates
- Bid validity period

Please submit your bid by ${bid_due_date || 'the specified due date'}.

---
${BID_DISCLAIMER}
---

Contact Information:
${sender_name || ''}
${sender_company || ''}
${sender_email ? `Email: ${sender_email}` : ''}
${sender_phone ? `Phone: ${sender_phone}` : ''}

Thank you for your interest in this project.

Best regards,
${sender_name || 'The Project Team'}
    `.trim()

    // Build SendGrid payload
    const sendGridPayload = {
      personalizations: [{
        to: [{ email: to_email, name: to_name }],
        subject: subject
      }],
      from: {
        email: sender_email || process.env.SENDGRID_FROM_EMAIL || 'noreply@bidcoordinator.com',
        name: sender_name || sender_company || 'BidCoordinator'
      },
      // Use inbound parse email if configured, otherwise fall back to sender email
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

    // Add attachments if we have any
    if (attachments.length > 0) {
      sendGridPayload.attachments = attachments
      console.log(`Attaching ${attachments.length} drawing file(s)`)
    }

    // Send via SendGrid
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

    // Save invitation tracking data to database for reply matching
    let trackingId = null
    // supabase already initialized above for drawings
    if (supabase && project_id && subcontractor_id) {
      try {
        const { data: invitation, error: invError } = await supabase
          .from('bid_invitations')
          .insert({
            project_id,
            subcontractor_id,
            to_email,
            subject,
            bid_item_ids: bid_item_ids || [],
            email_sent: true,
            status: 'sent'
          })
          .select('id, tracking_token')
          .single()

        // Also save to bid_round_invitations if we have a bid_round_id
        if (bid_round_id && !invError) {
          await supabase
            .from('bid_round_invitations')
            .upsert({
              bid_round_id,
              subcontractor_id,
              bid_item_ids: bid_item_ids || [],
              drawings_attached: drawings.map(d => d.id),
              email_sent: true,
              email_sent_at: new Date().toISOString(),
              status: 'invited'
            }, {
              onConflict: 'bid_round_id,subcontractor_id'
            })
        }

        if (!invError && invitation) {
          trackingId = invitation.tracking_token
          console.log('Invitation tracked:', invitation.id)
        } else if (invError) {
          console.warn('Failed to track invitation:', invError.message)
        }
      } catch (trackError) {
        console.warn('Error tracking invitation:', trackError.message)
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Bid invitation sent successfully',
        tracking_id: trackingId
      })
    }

  } catch (error) {
    console.error('Error sending email:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to send email', details: error.message })
    }
  }
}
