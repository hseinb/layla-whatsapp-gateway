/**
 * Phone number and WhatsApp JID formatting utilities
 */

export function cleanPhoneNumber(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export function formatToJid(target: string): string {
  const trimmed = target.trim();

  // If already formatted as JID (user, group, broadcast, newsletter)
  if (
    trimmed.endsWith('@s.whatsapp.net') ||
    trimmed.endsWith('@g.us') ||
    trimmed.endsWith('@broadcast') ||
    trimmed.endsWith('@newsletter')
  ) {
    return trimmed;
  }

  // Otherwise, clean and format as standard user JID
  const digits = cleanPhoneNumber(trimmed);
  if (!digits || digits.length < 6) {
    throw new Error(`Invalid phone number format: "${target}". Country code and digits required.`);
  }

  return `${digits}@s.whatsapp.net`;
}

export function jidToPhoneNumber(jid: string): string {
  return jid.split('@')[0] || '';
}
