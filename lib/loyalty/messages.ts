/* Fills a WhatsApp message template with a member's details: "Hi {name}!" -> "Hi Asha!".
   A word with no value is dropped, and the tidy-up keeps the sentence clean. */
export function fillMessage(template: string, values: Record<string, string | number | null | undefined>): string {
  return template
    .replace(/\{(\w+)\}/g, (_m, k: string) => String(values[k] ?? ""))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
