import type { ProfilePresentation } from "./profile-presentation"

/**
 * The profile "View an example" shows. A fictional studio, rendered through
 * the same component as the creator's own preview.
 *
 * Deliberately no figures: no sales, no follower counts, no shop counts. The
 * mockups' numbers are placeholders, and an example that quoted them would be
 * the first place an invented statistic reached a real screen.
 */
export const EXAMPLE_PROFILE: ProfilePresentation = {
  handle: "northline-studio",
  displayName: "Northline Studio",
  shortBio: "Independent type and templates for expressive brands.",
  about:
    "A two-person type foundry drawing display faces and the templates that put them to work. Every family ships with a specimen and a licence written in plain English.",
  avatarUrl: null,
  initials: "NS",
  // The optional fields filled in, so the example shows what they look like.
  // example.com is reserved for documentation and reaches nobody.
  location: "Brooklyn, United States",
  contact: { url: "mailto:hello@example.com", label: "hello@example.com" },
  links: [
    { kind: "website", url: "https://example.com/", label: "example.com" },
    { kind: "instagram", url: "https://www.instagram.com/example/", label: "Instagram" },
  ],
  specialties: [
    { type: "font", label: "Fonts" },
    { type: "template", label: "Templates" },
  ],
  products: [
    {
      key: "aster",
      title: "Aster Grotesk",
      productType: "font",
      typeLabel: "Font",
      imageUrl: null,
      imageAlt: "",
    },
    {
      key: "campaign",
      title: "Campaign Template Collection",
      productType: "template",
      typeLabel: "Template",
      imageUrl: null,
      imageAlt: "",
    },
  ],
}
