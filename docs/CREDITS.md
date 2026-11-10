# Credits

## Item photos

The demo listing photos in `public/items/` are third-party photographs used under Creative Commons licenses. Each file stays under the license listed for it below; those licenses cover the photos only, not the rest of this repository. All files were retrieved on 2026-11-10 and were changed only as described in the "Edits" column. The authors do not endorse this project.

| File | What it shows | Title | Author | License | Source page | Edits |
| --- | --- | --- | --- | --- | --- | --- |
| `public/items/bike-1.jpg` | Side view of a used child's bicycle with a green frame, red mudguards, red rear rack, teal saddle and training wheels, standing on paving stones | "Training wheels on a girl's bicycle, Oude Pekela (2019) 01" | Donald Trung Quoc Don (Chữ Hán: 徵國單), Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | <https://commons.wikimedia.org/wiki/File:Training_wheels_on_a_girl%27s_bicycle,_Oude_Pekela_(2019)_01.jpg> | Resized from the 1920 x 1080 Wikimedia rendition of the 4864 x 2736 original to 1280 x 720; re-encoded as JPEG (quality 82); metadata removed. Not cropped. |
| `public/items/bike-2.jpg` | The same bicycle seen from the front right, showing handlebar, bell, chain and one training wheel | "Training wheels on a girl's bicycle, Oude Pekela (2019) 05" | Donald Trung Quoc Don (Chữ Hán: 徵國單), Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | <https://commons.wikimedia.org/wiki/File:Training_wheels_on_a_girl%27s_bicycle,_Oude_Pekela_(2019)_05.jpg> | Cropped to the bicycle (kept 4% to 96% of the width and 27% to 80% of the height of the 1920 x 3413 Wikimedia rendition of the 2736 x 4864 original); resized to 1250 x 1280; re-encoded as JPEG (quality 82); metadata removed. |
| `public/items/table-1.jpg` | Square teak end table with round legs and a lower shelf, seen from above at an angle on a shop floor | "SOLD: Small teak end table, top" | The Living Room (Flickr user TheLivingRoominKenmore) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | <https://www.flickr.com/photos/thelivingroominkenmore/4527081675/> | Resized from 2048 x 1536 to 1280 x 960; re-encoded as JPEG (quality 82); metadata removed. Not cropped. |
| `public/items/table-2.jpg` | The same teak end table seen from the front at floor level, showing the legs and the slatted lower shelf | "SOLD: teak end table" | The Living Room (Flickr user TheLivingRoominKenmore) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | <https://www.flickr.com/photos/thelivingroominkenmore/4527711000/> | Resized from 2048 x 1536 to 1280 x 960; re-encoded as JPEG (quality 82); metadata removed. Not cropped. |
| `public/items/stroller-1.jpg` | Front view of a used baby stroller with a navy and white frame and navy striped seat fabric, standing on grass next to a sidewalk | "Peg Perego Stroller" | Daniel X. O'Neil (Flickr user danxoneil) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | <https://www.flickr.com/photos/juggernautco/207344120/> | Resized from 1944 x 2592 to 960 x 1280; re-encoded as JPEG (quality 82); metadata removed. Not cropped. |

## Mascots and artwork

Barley and Biscuit, the hot spring scene, the nose bump artwork and the app icon are original SVG artwork made for
this project (`components/mascots/`, `public/mascots/`, `app/icon.svg`). No third-party art was used. The characters
and the product name are reserved, see `TRADEMARKS.md`.

## Font

| File | Font | Authors | License | Source |
| --- | --- | --- | --- | --- |
| `public/fonts/Fredoka-latin.woff2` | Fredoka (variable, Latin subset) | The Fredoka Project Authors | [SIL Open Font License 1.1](https://openfontlicense.org/) | <https://fonts.google.com/specimen/Fredoka> |

## Voices

The video narration and the mascots' voice lines in `public/audio/` were generated with ElevenLabs
(model `eleven_multilingual_v2`) using its premade voices: Jessica (narrator), Callum (Barley) and Lily (Biscuit).
The running app plays the pre-rendered files and never calls ElevenLabs. The video has no music.

## Third-party skills in this repository

The files under `.claude/skills/typescript-*` are APIMatic's PayPal Context Plugin skills for TypeScript, from
<https://github.com/context-plugins/plugin-marketplace> (commit `7cbdf85dc95f09d9ede8c5d349506686684fa0d4`),
MIT License, Copyright (c) 2026- APIMatic. See `.claude/skills/README.md` for the one change made to them.

## Open-source packages

The app is built on Next.js and React (MIT), Tailwind CSS (MIT), `@paypal/paypal-server-sdk` (MIT),
`@paypal/agent-toolkit` (ISC), the OpenAI SDK (Apache-2.0), `qrcode` (MIT), `jsqr` (Apache-2.0),
`@vercel/blob` (Apache-2.0), axios (MIT), Vitest (MIT) and Playwright (Apache-2.0). Each package keeps its own license.

## Names

PayPal is a trademark of PayPal, Inc. This project uses PayPal's sandbox and is not affiliated with or endorsed by
PayPal. The demo video shows PayPal's own approval window because PayPal is the hackathon's sponsor; no other brand
appears in it. Maya, Theo and their listings are fictional.
