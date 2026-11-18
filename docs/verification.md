# Verification

The release starts with zero posts, projects and changelog entries. Test fixtures run in temporary builds and in an in-memory database.

| Check | Observed result |
| --- | --- |
| Static HTML and nested routes | Empty site generated 14 HTML files. Build tests covered a GitHub project path, custom-domain account build, nested assets, redirect verification, RSS and sitemap. |
| Published article fixture | Title, prose, italic, handwriting, and canonical metadata appeared in the generated HTML. The fixture reached search and RSS from the same snapshot. Rebuilding with an empty snapshot removed its files and redirects. |
| Guest experience | Tested the combined preference dialog, theme persistence, all six trophies, the phrase through search, all four shower sprites, the exact 404 and 405 responses, ordinary search, minimize and maximize, and keyboard close and reopen with preserved input and focus. |
| Responsive Home | Checked 360, 768 and 1440 px viewports. Navigation wrapped into two horizontal rows on the smallest width and had no horizontal overflow. |
| Database | PGlite ran the real migrations with Auth and Storage schema fixtures. Checks covered role gates, Owner MFA, publication snapshots, failed releases, comment moderation and alert deduplication, subscription confirmation, anonymous open deduplication, and stable trophy edits and claims. |
| Ads | The artifact checks covered disabled previews and empty pages, separate account HTML, and the approved-domain build gate. |

## Confirm after connecting production services

1. Verify a real GitHub Pages deployment with the exact repository path and custom domains, if applicable. Check the release marker and deploy a test article before using the dashboard for permanent content.
2. Use two consenting test accounts to exercise the Supabase OTP and Owner TOTP flow, bookmarks, comments, profile changes, export, and a guest collection import. Verify attachment uploads, responsive derivatives and the private preview from the live app.
3. Add two verified comment-alert addresses and one paused address, then test pending and approved-only delivery, scoped post rules, mail retry behavior and the signed provider webhook.
4. Verify subscription confirmation, weekly digest timing, unsubscribe and suppression after a pending change. Confirm jobs on the Email tab.
5. If enabling AdSense, use the approved origin and certified CMP. Check that an opted-out or ineligible page makes zero requests, that an eligible consenting article shows one slot, and that revocation and the dashboard switch prevent new requests.
6. Repeat the window and art interactions on a physical touch device and with reduced motion. Real provider-level delivery, touch hardware and the live CMP need those configurations and devices.
