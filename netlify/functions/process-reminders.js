/**
 * Process Reminder Queue
 *
 * This function processes the reminder queue and sends automated follow-up emails.
 * Can be triggered by a scheduled event or manually.
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

/**
 * Send a reminder email via SendGrid
 */
async function sendReminderEmail(apiKey, reminderData, settings) {
  const {
    to_email,
    to_name,
    project_name,
    bid_item_description,
    bid_due_date,
    sender_name,
    sender_company,
    sender_email,
    reminder_number
  } = reminderData

  // Build subject from template
  let subject = settings.reminder_subject_template || 'Reminder: Bid Request for {{project_name}}'
  subject = subject.replace('{{project_name}}', project_name)
  if (reminder_number > 1) {
    subject = `[Reminder ${reminder_number}] ${subject}`
  }

  // Build message from template
  let message = settings.reminder_message_template || 'This is a friendly reminder about our bid request.'
  message = message
    .replace('{{project_name}}', project_name)
    .replace('{{bid_item}}', bid_item_description || '')
    .replace('{{due_date}}', bid_due_date || 'as soon as possible')

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background-color: #f39c12; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .highlight { background-color: #fef9e7; border-left: 4px solid #f39c12; padding: 15px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>Bid Request Reminder${reminder_number > 1 ? ` #${reminder_number}` : ''}</h2>
      </div>

      <div class="content">
        <p>Dear ${to_name || 'Contractor'},</p>

        <p>${message}</p>

        <div class="highlight">
          <strong>Project:</strong> ${project_name}<br>
          ${bid_item_description ? `<strong>Scope:</strong> ${bid_item_description}<br>` : ''}
          ${bid_due_date ? `<strong>Due Date:</strong> ${bid_due_date}` : ''}
        </div>

        <p>We value your partnership and would appreciate your response. If you have any questions or need additional information, please don't hesitate to reach out.</p>

        <p>If you've already submitted your bid, please disregard this reminder.</p>

        <p style="margin-top: 30px;">
          Best regards,<br>
          ${sender_name || sender_company || 'The Project Team'}
        </p>
      </div>

      <div class="footer">
        <p>This is an automated reminder from BidCoordinator</p>
      </div>
    </body>
    </html>
  `

  const textContent = `
BID REQUEST REMINDER${reminder_number > 1 ? ` #${reminder_number}` : ''}

Dear ${to_name || 'Contractor'},

${message}

PROJECT: ${project_name}
${bid_item_description ? `SCOPE: ${bid_item_description}` : ''}
${bid_due_date ? `DUE DATE: ${bid_due_date}` : ''}

We value your partnership and would appreciate your response. If you have any questions or need additional information, please don't hesitate to reach out.

If you've already submitted your bid, please disregard this reminder.

Best regards,
${sender_name || sender_company || 'The Project Team'}
  `.trim()

  const sendGridPayload = {
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
    ]
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
    throw new Error(`SendGrid API error: ${response.status} - ${errorText}`)
  }

  return true
}

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  // Health check
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        endpoint: 'process-reminders',
        hasApiKey: !!process.env.SENDGRID_API_KEY
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
      body: JSON.stringify({ error: 'SendGrid API key not configured' })
    }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Supabase not configured' })
    }
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {}
    const { manual_bid_ids, dry_run } = body

    // Get reminder settings
    const { data: settings } = await supabase
      .from('reminder_settings')
      .select('*')
      .single()

    const reminderSettings = settings || {
      first_reminder_days: 3,
      second_reminder_days: 5,
      final_reminder_days: 7,
      max_reminders: 3,
      reminder_subject_template: 'Reminder: Bid Request for {{project_name}}',
      reminder_message_template: 'This is a friendly reminder about our bid request for {{project_name}}.'
    }

    let bidsToProcess = []

    if (manual_bid_ids && manual_bid_ids.length > 0) {
      // Process specific bids manually
      const { data: bids } = await supabase
        .from('bids')
        .select(`
          *,
          subcontractor:subcontractors (id, company_name, email),
          bid_item:bid_items (
            id, description, bid_due_date,
            project:projects (id, name)
          )
        `)
        .in('id', manual_bid_ids)
        .eq('status', 'invited')

      bidsToProcess = bids || []
    } else {
      // Get bids from queue that are ready
      const { data: queueItems } = await supabase
        .from('reminder_queue')
        .select(`
          *,
          bid:bids (
            *,
            subcontractor:subcontractors (id, company_name, email),
            bid_item:bid_items (
              id, description, bid_due_date,
              project:projects (id, name)
            )
          )
        `)
        .eq('status', 'pending')
        .lte('scheduled_for', new Date().toISOString())
        .limit(50)

      // Also get bids that need reminders but aren't in queue
      const { data: unqueuedBids } = await supabase
        .from('bids')
        .select(`
          *,
          subcontractor:subcontractors (id, company_name, email),
          bid_item:bid_items (
            id, description, bid_due_date,
            project:projects (id, name)
          )
        `)
        .eq('status', 'invited')
        .eq('reminders_paused', false)
        .lt('reminder_count', reminderSettings.max_reminders)
        .or(`next_reminder_at.is.null,next_reminder_at.lte.${new Date().toISOString()}`)
        .limit(50)

      // Combine and deduplicate
      const queueBids = (queueItems || []).map(q => ({ ...q.bid, queue_id: q.id, reminder_number: q.reminder_number }))
      const allBids = [...queueBids]

      // Add unqueued bids that aren't already in queue
      const queuedBidIds = new Set(queueBids.map(b => b.id))
      for (const bid of (unqueuedBids || [])) {
        if (!queuedBidIds.has(bid.id)) {
          // Calculate reminder number
          const daysSinceInvitation = Math.floor((Date.now() - new Date(bid.invitation_sent_at).getTime()) / (1000 * 60 * 60 * 24))

          let shouldRemind = false
          if (bid.reminder_count === 0 && daysSinceInvitation >= reminderSettings.first_reminder_days) {
            shouldRemind = true
          } else if (bid.reminder_count === 1 && daysSinceInvitation >= reminderSettings.second_reminder_days) {
            shouldRemind = true
          } else if (bid.reminder_count === 2 && daysSinceInvitation >= reminderSettings.final_reminder_days) {
            shouldRemind = true
          }

          if (shouldRemind) {
            allBids.push({ ...bid, reminder_number: bid.reminder_count + 1 })
          }
        }
      }

      bidsToProcess = allBids
    }

    // Filter out bids without email
    bidsToProcess = bidsToProcess.filter(bid =>
      bid.subcontractor?.email && bid.bid_item?.project
    )

    if (bidsToProcess.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No reminders to send',
          processed: 0
        })
      }
    }

    const results = {
      sent: 0,
      failed: 0,
      skipped: 0,
      details: []
    }

    for (const bid of bidsToProcess) {
      const reminderNumber = bid.reminder_number || bid.reminder_count + 1

      if (reminderNumber > reminderSettings.max_reminders) {
        results.skipped++
        results.details.push({
          bid_id: bid.id,
          status: 'skipped',
          reason: 'Max reminders reached'
        })
        continue
      }

      const reminderData = {
        to_email: bid.subcontractor.email,
        to_name: bid.subcontractor.company_name,
        project_name: bid.bid_item.project.name,
        bid_item_description: bid.bid_item.description,
        bid_due_date: bid.bid_item.bid_due_date,
        reminder_number: reminderNumber,
        sender_company: 'Clipper Construction'
      }

      if (dry_run) {
        results.sent++
        results.details.push({
          bid_id: bid.id,
          status: 'would_send',
          to: bid.subcontractor.email,
          reminder_number: reminderNumber
        })
        continue
      }

      try {
        await sendReminderEmail(apiKey, reminderData, reminderSettings)

        // Update bid
        await supabase
          .from('bids')
          .update({
            reminder_count: reminderNumber,
            last_reminder_at: new Date().toISOString(),
            next_reminder_at: null // Will be recalculated
          })
          .eq('id', bid.id)

        // Log to reminder history
        await supabase
          .from('reminder_history')
          .insert({
            bid_id: bid.id,
            subcontractor_id: bid.subcontractor_id,
            project_id: bid.bid_item.project.id,
            bid_item_id: bid.bid_item_id,
            reminder_number: reminderNumber,
            reminder_type: manual_bid_ids ? 'manual' : 'automatic',
            to_email: bid.subcontractor.email,
            subject: `Reminder ${reminderNumber}: ${bid.bid_item.project.name}`,
            status: 'sent'
          })

        // Update queue if from queue
        if (bid.queue_id) {
          await supabase
            .from('reminder_queue')
            .update({
              status: 'sent',
              processed_at: new Date().toISOString()
            })
            .eq('id', bid.queue_id)
        }

        // Log communication
        await supabase.from('communications').insert({
          subcontractor_id: bid.subcontractor_id,
          project_id: bid.bid_item.project.id,
          type: 'email_sent',
          subject: `Automated reminder #${reminderNumber} sent`,
          notes: `Automated follow-up reminder for ${bid.bid_item.description}`
        })

        results.sent++
        results.details.push({
          bid_id: bid.id,
          status: 'sent',
          to: bid.subcontractor.email,
          reminder_number: reminderNumber
        })

      } catch (error) {
        console.error(`Failed to send reminder for bid ${bid.id}:`, error)

        // Log failure
        await supabase
          .from('reminder_history')
          .insert({
            bid_id: bid.id,
            subcontractor_id: bid.subcontractor_id,
            project_id: bid.bid_item.project.id,
            reminder_number: reminderNumber,
            reminder_type: manual_bid_ids ? 'manual' : 'automatic',
            to_email: bid.subcontractor.email,
            status: 'failed',
            error_message: error.message
          })

        // Update queue if from queue
        if (bid.queue_id) {
          await supabase
            .from('reminder_queue')
            .update({
              status: 'failed',
              processed_at: new Date().toISOString(),
              error_message: error.message
            })
            .eq('id', bid.queue_id)
        }

        results.failed++
        results.details.push({
          bid_id: bid.id,
          status: 'failed',
          error: error.message
        })
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Processed ${bidsToProcess.length} reminders`,
        results
      })
    }

  } catch (error) {
    console.error('Error processing reminders:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process reminders',
        details: error.message
      })
    }
  }
}
