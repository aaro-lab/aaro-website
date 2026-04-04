export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, inquiry } = req.body || {};
  if (!name || !inquiry) {
    return res.status(400).json({ error: 'Name and inquiry are required' });
  }

  const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const errors = [];

  // 1. Send to Slack
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    try {
      const slackRes = await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `📩 *새 문의가 접수되었습니다*`,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '📩 새 문의 접수', emoji: true }
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*이름/기관명*\n${name}` },
                { type: 'mrkdwn', text: `*접수 시간*\n${timestamp}` }
              ]
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*문의 사항*\n${inquiry}` }
            },
            { type: 'divider' },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: 'aaro-website 문의 폼에서 발송됨' }
              ]
            }
          ]
        })
      });
      if (!slackRes.ok) errors.push('Slack delivery failed');
    } catch (e) {
      errors.push('Slack delivery error');
    }
  }

  // 2. Send email via Resend (if configured) or fallback log
  const resendKey = process.env.RESEND_API_KEY;
  const emailTo = process.env.CONTACT_EMAIL || 'architecture.algorithm@gmail.com';
  if (resendKey) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`
        },
        body: JSON.stringify({
          from: 'AARO Website <onboarding@resend.dev>',
          to: emailTo,
          subject: `[AARO 문의] ${name}`,
          html: `
            <h2>새 문의가 접수되었습니다</h2>
            <p><strong>이름/기관명:</strong> ${name}</p>
            <p><strong>문의 사항:</strong></p>
            <p>${inquiry.replace(/\n/g, '<br>')}</p>
            <hr>
            <p style="color:#888; font-size:12px;">접수 시간: ${timestamp}</p>
          `
        })
      });
      if (!emailRes.ok) errors.push('Email delivery failed');
    } catch (e) {
      errors.push('Email delivery error');
    }
  }

  if (errors.length && !slackWebhook && !resendKey) {
    return res.status(500).json({ error: 'No delivery channels configured' });
  }

  return res.status(200).json({ ok: true, errors });
}
