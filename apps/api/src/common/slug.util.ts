// Normalize arbitrary text into a URL/identifier-safe slug. Shared by org
// creation (admin) and registration (join-by-slug) so both agree on the form.
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}
