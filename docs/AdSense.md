# AdSense for Localhost Diaries

Start with zero ads. Once the archive has substantial original posts, the site has traffic you can measure, and Google has approved your domain, test one manual slot on eligible articles. Keep the homepage, archive, newsletter, comments, and account pages ad-free. On a technical blog, preserving a continuous reading and debugging flow is more valuable than squeezing a slot into every page.

## Which placement makes sense?

| Placement | Recommendation | Reason |
| --- | --- | --- |
| After several substantial paragraphs on a long post | First test | Readers see the article first. The slot can appear between prose blocks with comfortable separation. |
| After the article body | Second test | Gentler for tutorials and code-heavy posts. A reader who leaves early will miss the slot. |
| Next to code-copy buttons, links, navigation, or sign-in | Skip | Accidental clicks and confusion about which elements are site controls. |
| Sidebar or homepage | Skip initially | Crowds the retro utility panels, especially at phone width. |
| Archive, search, 404, collection, email, reader account, and Owner pages | Leave ad-free | These pages serve navigation, privacy, or account tasks. |

The implementation permits at most one responsive slot per post. It requires the Owner's per-post flag, at least 450 words and at least four top-level paragraphs. The inline placement also requires four substantial rendered paragraphs. The slot collapses when inactive. Its visible label is **Advertisements**.

## Revenue scenarios

Google defines page RPM as estimated earnings divided by page views, multiplied by 1,000. Use actual **AdSense page views** for this calculation. The dashboard's aggregate opens are a different metric. The figures below only illustrate the arithmetic. Consent, visitor location, demand, and traffic mix affect the observed result.

| Monthly AdSense page views | At $1 RPM | At $3 RPM | At $6 RPM |
| ---: | ---: | ---: | ---: |
| 1,000 | $1 | $3 | $6 |
| 5,000 | $5 | $15 | $30 |
| 20,000 | $20 | $60 | $120 |

An early blog with 1,000 total article opens will typically have fewer ad-reportable views after page eligibility, consent, and blocking. Delay the test if the likely income is smaller than the effort of running consent and maintaining the setup. Once live, compare a period with ads to a similar period without ads, checking mobile layout, performance and engagement as well as revenue. Keep the kill switch handy.

## Activation

1. Serve the public blog from the root of a domain you control and the authenticated tools from a different origin. Follow the README's separate deployment instructions. Verify that public pages do not initialize Supabase Auth or load the private bundle, and that the account site loads no ad adapter.
2. In **AdSense → Sites**, add the public domain and complete ownership verification. Set GitHub variable `ADS_PUBLISHER` to the Google-issued `ca-pub-XXXXXXXXXXXXXXXX`. The build can output the verification meta tag and root `ads.txt` with ads disabled. Compare the generated `ads.txt` to the exact record shown in your AdSense dashboard. Wait for Google approval.
3. In **AdSense → Ads → By ad unit**, create a responsive display ad unit and use its numeric slot as `ADS_SLOT`. Keep Auto ads disabled for this controlled test.
4. Set up a Google-certified CMP where applicable. This project provides a consent adapter for a certified CMP that exposes the IAB TCF JavaScript API. Configure its host-approved HTTPS bootstrap URL as `ADS_CMP_SCRIPT`. A provider-specific bridge must expose `window.diariesOpenConsent()` for the **Cookies & theme** review control and load no Google ad code on its own. The visitor first enables advertising inside **Cookies & theme**. The adapter then waits for a TCF response with consent for purpose 1 and Google vendor 755 before initializing the slot. This conservative approach can leave ads disabled for readers who decline or whose consent callback is unavailable. Test the CMP's certified configuration and actual regional behavior before serving ads. A provider-specific installation is required if its bootstrap cannot meet this contract.
5. Set `ADS_APPROVED=true` and `ADS_APPROVED_ORIGIN` to the exact approved HTTPS origin in the public Pages repository. Run the public deploy workflow. In **Owner dashboard → Settings**, enable the live ad switch, and in a substantial published post set **Eligible for one ad slot** and choose the placement. Deploy the approved revision.
6. Test with a clean browser. Ensure no Adsense requests before consent, with consent denied, in the local preview, or on the account origin. Confirm there is one marked slot on an eligible post after accepted consent. Verify the privacy control can withdraw consent and that the next page load stays ad-free. Test phone and desktop widths. Never click your own live ads.
7. Disable future loads from **Settings → Allow live ads on production-eligible pages**. The public ad adapter checks this setting before loading the CMP or ad script. For maintenance, also set `ADS_APPROVED=false` and redeploy. Loaded scripts can remain in an already-open tab until it is closed or reloaded.

Check GitHub's Pages terms for your planned use. The service is intended for personal and organizational projects, with restrictions on sites primarily used for commercial transactions or SaaS. AdSense approval and revenue depend on Google's review and the traffic the site receives.

## Official references

- [AdSense site setup and verification](https://support.google.com/adsense/answer/9131547)
- [AdSense consent requirements for the EEA, UK and Switzerland](https://support.google.com/adsense/answer/13554116)
- [AdSense consent management platform setup](https://support.google.com/adsense/answer/7670013)
- [AdSense ads.txt guide](https://support.google.com/adsense/answer/7532444)
- [AdSense page RPM](https://support.google.com/adsense/answer/190515)
- [GitHub Pages product terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages)
