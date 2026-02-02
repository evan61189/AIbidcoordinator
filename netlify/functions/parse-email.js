import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export async function handler(event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    const { email_content, project_id } = JSON.parse(event.body)

    if (!email_content) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'email_content is required' })
      }
    }

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
  "confidence": <number 0-1 - your confidence in the extraction accuracy>
}

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
      parsedData = extractWithRules(email_content)
    }

    // Add suggested matches placeholder (would need Supabase connection for full implementation)
    parsedData.suggested_matches = {
      subcontractor: null,
      project: project_id ? { id: project_id } : null,
      bid_items: []
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
      const { email_content } = JSON.parse(event.body)
      const fallbackData = extractWithRules(email_content)

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

function extractWithRules(emailContent) {
  const bidData = {
    amount: null,
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

  return {
    bid_data: bidData,
    sender_info: senderInfo,
    confidence: Math.min(confidence, 0.9),
    suggested_matches: {
      subcontractor: null,
      project: null,
      bid_items: []
    }
  }
}
