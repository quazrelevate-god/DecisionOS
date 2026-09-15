# DecisionOS Landing Page — Build Tracker

Here are all the steps taken, in sequence.

## Discovery & Planning

1. Studied a reference site's content architecture and mapped the DecisionOS Vision PDF into a matching content structure, approved before building
2. Extracted brand guidelines (colours, typography) from the live MVP
3. Scripted a hero background video treatment for AI video generation
4. Decided to build locally first, with server deployment deferred

## Initial Build

5. Built the hero section with image background, left-aligned copy, and contrast typography
6. Built the glassmorphism nav header that hides on the hero and swipes in on scroll
7. Set up a local dev server
8. Simplified the hero to pre-header, header, and CTA only
9. Removed pre-headers from every section to kill the "slide deck" feel
10. Rebuilt the Problem section as a rounded container with individual problem cards
11. Added a brand-colour grid background with parallax to the Problem section
12. Removed all em dashes across the page (71 rewrites)
13. Rebuilt the pre-footer/final CTA in a clouds-and-stars parallax style
14. Rebuilt the comparison table as four vertical containers with DecisionOS lifted and floating

## Section-by-Section Dynamic Redesign

15. Built the WhisperFlow-style slice transition for the "business at scale" section
16. Added a scroll-drawn scribble behind the comparison section (later removed)
17. Rebuilt "How It Works" as a 10-second counter section with bento cards
18. Rebuilt the roadmap as an orbit/solar-system visual with merged stage copy
19. Built the DNA section's day-1-to-month-12 curve graph with animated dot field
20. Built the CEO Brief section with auto-cycling tabs, an animated score dial, and an ask bar
21. Built the pricing section with glassmorphism cards and an early-access modal
22. Added the new DecisionOS logo to the navbar and hero
23. Built the four-container ICP/roles section with hover interactions
24. Removed the standalone Company Brain section and merged its content elsewhere

## First Bug-Fix Pass

25. Fixed a heredoc escaping bug that was garbling checkmark characters
26. Fixed invisible orbit capability pills (white text on white)
27. Fixed broken HTML nesting in the flow-lane pills
28. Fixed the seam line between the Problem and Scale sections
29. Fixed pill overlap in the flow animation's shared lane
30. Fixed a glitch in the DNA dot-loop animation
31. Fixed the DNA endpoint drifting outside its bounding box
32. Fixed the ask bar resizing as its text cycled
33. Fixed a parallax handler conflict on the ghost text
34. Fixed the hero logo's optical alignment against the headline

## Full Audit & Top 5 Fixes

35. Ran a full UX/UI/product audit and rated consistency across the page
36. Standardized the border-radius scale to four steps
37. Reordered the nav and added a Pricing link
38. Cut the animation motion budget from 148 running loops down to 13
39. Split overloaded copy in two sections for clarity
40. Added a hero background video (later reverted)
41. Compressed the hero image and ICP photos by roughly 97%

## Refinement Round

42. Reverted the hero video back to the static photo
43. Rebuilt the section dividers as matching rounded-corner overlap transitions
44. Pinned the hero so it blurs as the next section scrolls over it
45. Rebuilt the scribble as one smooth brush loop (later removed entirely)
46. Redrew the DNA endpoint ring as a hand-drawn pencil oval
47. Added a shared scroll-inertia driver so all scroll animation eases instead of snapping
48. Fixed the unstyled "10 seconds" tail line
49. Fixed the trust-strip spacing above and within the band
50. Re-aligned the hero logo again after further review
51. Fixed the "10" numeral being visually clipped
52. Redesigned the pricing section to match the site's dark/indigo language instead of a mismatched rainbow background
53. Removed the comparison-section scribble entirely

## Version Control & Hosting

54. Initialized a git repo scoped to the landing page folder only
55. Committed and pushed the site to GitHub

## Still Open

56. FAQ section direction — awaiting sign-off
57. Logo colour vs. brand colour mismatch — flagged, unresolved
58. GitHub Pages hosting — awaiting go-ahead
59. Production deployment beyond GitHub Pages — deferred
