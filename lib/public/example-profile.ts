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
  avatarUrl: null,
  initials: "NS",
  links: [
    { kind: "website", url: "https://example.com/", label: "example.com" },
    { kind: "instagram", url: "https://www.instagram.com/example/", label: "@example" },
  ],
  products: [
    { key: "aster", title: "Aster Grotesk", typeLabel: "Font", imageUrl: null, imageAlt: "" },
    {
      key: "campaign",
      title: "Campaign Template Collection",
      typeLabel: "Template",
      imageUrl: null,
      imageAlt: "",
    },
  ],
}
