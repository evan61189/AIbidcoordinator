/**
 * SendGrid email service for sending bid invitations
 */

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send'

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
      custom_message
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

          ${bid_items && bid_items.length > 0 ? `
            <h3>Scope of Work</h3>
            <p>Please provide pricing for the following items:</p>
            ${bidItemsHtml}
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

    // Send via SendGrid
    const response = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: to_email, name: to_name }],
          subject: subject
        }],
        from: {
          email: sender_email || process.env.SENDGRID_FROM_EMAIL || 'noreply@bidcoordinator.com',
          name: sender_name || sender_company || 'BidCoordinator'
        },
        reply_to: sender_email ? { email: sender_email, name: sender_name } : undefined,
        content: [
          { type: 'text/plain', value: textContent },
          { type: 'text/html', value: htmlContent }
        ],
        tracking_settings: {
          click_tracking: { enable: true },
          open_tracking: { enable: true }
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('SendGrid error:', errorText)
      throw new Error(`SendGrid API error: ${response.status}`)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Bid invitation sent successfully'
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
