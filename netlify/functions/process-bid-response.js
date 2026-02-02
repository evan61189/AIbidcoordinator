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
 */
async function findMatchingContext(fromEmail, subject) {
  if (!supabase) return null

  // First, try to find by subcontractor email
  const { data: subs } = await supabase
    .from('subcontractors')
    .select('id, company_name, email')
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

  return {
    subcontractor,
    invitation: matchedInvitation,
    project: matchedInvitation?.projects
  }
}

/**
 * Analyze email body and attachments with Claude AI
 */
async function analyzeWithAI(emailBody, attachments) {
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

  // Add extraction prompt
  content.push({
    type: 'text',
    text: `Based on the email body and any attachments above, extract the bid/quote information.

Return JSON only:
{
  "total_amount": number or null,
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

    console.log('Parsed email fields:', Object.keys(fields))
    console.log('Attachments count:', attachments.length)

    // Extract email details
    const fromEmail = fields.from?.match(/<(.+)>/)?.[1] || fields.from || ''
    const fromName = fields.from?.replace(/<.+>/, '').trim() || ''
    const toEmail = fields.to || ''
    const subject = fields.subject || ''
    const bodyPlain = fields.text || ''
    const bodyHtml = fields.html || ''

    console.log(`From: ${fromEmail}`)
    console.log(`Subject: ${subject}`)
    console.log(`Body length: ${bodyPlain.length} chars`)
    console.log(`Attachments: ${attachments.map(a => `${a.filename} (${a.contentType})`).join(', ')}`)

    // Find matching project/subcontractor
    const context = await findMatchingContext(fromEmail, subject)
    console.log('Matched context:', {
      subcontractor: context?.subcontractor?.company_name,
      project: context?.project?.name
    })

    // Analyze with AI - both body and attachments
    console.log('Starting AI analysis...')
    const parsedBid = await analyzeWithAI(bodyPlain || bodyHtml, attachments)
    console.log('AI analysis complete:', {
      total: parsedBid.total_amount,
      lineItems: parsedBid.line_items?.length || 0,
      confidence: parsedBid.confidence_score
    })

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
          project: context?.project?.name || null
        },
        extracted: {
          total_amount: parsedBid.total_amount,
          line_items_count: parsedBid.line_items?.length || 0,
          has_exclusions: !!parsedBid.scope_excluded,
          has_clarifications: !!parsedBid.clarifications,
          confidence_score: parsedBid.confidence_score
        },
        saved: !!savedData
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
