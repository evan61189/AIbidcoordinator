import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

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
         Check if they provided a SINGLE lump sum for multiple packages (needs clarification) vs separate pricing per package (acceptable).`
      : ''

    // Use Anthropic Claude to parse the email
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Parse this contractor bid email and extract the following information. Return ONLY a valid JSON object with these exact fields (use null for missing values):

{
  "bid_data": {
    "amount": <number or null - total bid amount without currency symbol>,
    "amounts_by_package": <object or null - if they broke down by package, e.g. {"Electrical": 50000, "Fire Alarm": 25000}>,
    "includes": <string or null - what's included in the bid>,
    "excludes": <string or null - what's excluded from the bid>,
    "clarifications": <string or null - any notes, assumptions, or clarifications>,
    "lead_time": <string or null - delivery or lead time>,
    "valid_until": <string or null - how long the bid is valid>
  },
  "sender_info": {
    "company_name": <string or null - company name>,
    "contact_name": <string or null - person's name>,
    "email": <string or null - email address>,
    "phone": <string or null - phone number>
  },
  "needs_clarification": <boolean - true if they gave a single lump sum for multiple packages without breakdown>,
  "clarification_reason": <string or null - why clarification is needed>,
  "confidence": <number 0-1 - your confidence in the extraction accuracy>
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

    // If clarification needed, fetch subcontractor info for the response
    if (parsedData.needs_clarification && subcontractor_id) {
      const supabase = getSupabase()
      if (supabase) {
        try {
          const { data: sub } = await supabase
            .from('subcontractors')
            .select('id, company_name, contact_name, email')
            .eq('id', subcontractor_id)
            .single()

          if (sub) {
            parsedData.subcontractor_for_clarification = sub
          }
        } catch (e) {
          console.warn('Could not fetch subcontractor:', e.message)
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
