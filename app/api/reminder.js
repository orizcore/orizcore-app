export default async function handler(req, res) {
  // Protection : évite que n'importe qui déclenche l'envoi
        const authHeader = req.headers['authorization'];
  const querySecret = req.query.secret;
  const expected = process.env.CRON_SECRET;

  if (req.query.debug === '1') {
    return res.status(200).json({
      expectedExists: !!expected,
      expectedLength: expected ? expected.length : 0,
      querySecretLength: querySecret ? querySecret.length : 0,
      match: querySecret === expected
    });
  }

  if (authHeader !== `Bearer ${expected}` && querySecret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  const currentMonth = new Date().toISOString().slice(0, 7); // "2026-08"

  // 1. Récupérer les users avec consentement marketing
  const paramsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/params?marketing_consent=eq.true&select=user_id,prenom`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const users = await paramsRes.json();

  // 2. Récupérer les bilans déjà faits ce mois-ci
  const bilansRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bilans?mois=eq.${currentMonth}&select=user_id`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const bilansFaits = new Set((await bilansRes.json()).map(b => b.user_id));

  // 3. Récupérer les emails via l'API Auth admin
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const authData = await authRes.json();
  const emailByUserId = Object.fromEntries(authData.users.map(u => [u.id, u.email]));

  const aRelancer = users.filter(u => !bilansFaits.has(u.user_id) && emailByUserId[u.user_id]);

  let sent = 0;
  for (const u of aRelancer) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Orizcore <noreply@orizcore.com>',
        to: emailByUserId[u.user_id],
        subject: 'Ton bilan du mois t\'attend 📊',
        html: `<p>Salut ${u.prenom || ''} 👋</p>
               <p>Le mois touche à sa fin, c'est le moment de faire ton bilan financier sur Orizcore pour garder ton score de discipline à jour.</p>
               <p><a href="https://app.orizcore.com" style="background:#D4A017;color:#0B1437;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Faire mon bilan</a></p>`
      })
    });
    sent++;
  }

  return res.status(200).json({ sent });
}
