// One item per WhatsApp number in Config.digest_numbers.

function buildRecipients(numbers, message) {
  return (Array.isArray(numbers) ? numbers : [])
    .map((n) => String(n).replace(/\D/g, ''))
    .filter((n) => n.length >= 10)
    .map((number) => ({ number, text: message }));
}

// @n8n-entry
const config = $('Config').first().json;
const message = $('Montar mensagem').first().json.message;
return buildRecipients(config.digest_numbers, message).map((r) => ({ json: r }));
