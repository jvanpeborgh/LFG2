# How Claude reads requests

Kind right 32/32 · buildable 32/32 · median 3193 ms, slowest 4385 ms

| request | expected | read as | builds | what |
| --- | --- | --- | --- | --- |
| a sleepy dragon I can ride | creature | creature | ✓ | Sleepy Dragon: four-legged-creature/dragon, passive, walk, 6 long, ×1, ride [dragon head, membrane wings, long tail, horns, saddle] |
| a fast horse | creature | creature | ✓ | Fast Horse: four-legged-creature/equine, passive, walk, 2.4 long, ×1, ride [hooves, horse mane, flowing tail] |
| three angry wolves | creature | creature | ✓ | Angry Wolf: four-legged-creature/canine, hostile, walk, 1.6 long, ×3 [teeth, bushy tail, glowing eyes] |
| a teapot that walks around on little legs | creature | creature | ✓ | Walking Teapot: crawler/turtle, passive, walk, 0.8 long, ×1 [short legs, glossy] |
| a mimic chest that bites | creature | creature | ✓ | Mimic Chest: crawler/crawler, hostile, walk, 1.2 long, ×1 [teeth, metal, short legs, forked tongue] |
| the ghost of a pirate captain | creature | creature | ✓ | Ghost Pirate Captain: floating-spirit/person, hostile, hover, 2 long, ×1 [tricorn, beard, sword, glowing eyes, glow, cloak] |
| a cute axolotl | creature | creature | ✓ | Cute Axolotl: swimmer/reptile, passive, swim, 0.8 long, ×1 [gills, big eyes, long tail] |
| a giant mechanical spider made of brass | creature | creature | ✓ | Brass Mechanical Spider: crawler/crawler, neutral, walk, 6 long, ×1 [eight legs, metal, many eyes, glowing eyes] |
| a flock of glowing butterflies | creature | creature | ✓ | Glowing Butterfly: winged-creature/-, passive, fly, 0.6 long, ×5 [insect wings, patterned wings, antennae, glow, sparkles] |
| a red sports car | vehicle | vehicle | ✓ | Red Sports Car (car) |
| a monster truck with huge wheels | vehicle | vehicle | ✓ | Monster Truck (truck) |
| something to drive around in | vehicle | vehicle | ✓ | Cruiser (car) |
| a mario kart course, 5 laps | race | race | ✓ | Kart Grand Prix: 5 laps in karts |
| a race with dune buggies around the lake | race | race | ✓ | Lakeside Buggy Rally: 3 laps in buggys |
| hunt down a frost wyrm | hunt | hunt | ✓ | Frost Wyrm, 15 min |
| I want to track and kill the great boar of the forest | hunt | hunt | ✓ | Great Boar, 15 min |
| moon gravity for ten minutes | happening | happening | ✓ | Moon Gravity: gravity ×0.2, jumpBlocks ×3.5, fallDamageAfterBlocks ×5 (10 min) |
| make everyone tiny and fast | happening | happening | ✓ | Tiny Speedsters: scale ×0.35, walkSpeed ×1.8, sprintSpeed ×1.9 (5 min) |
| the floor is lava | happening | happening | ✓ | The Floor Is Lava:  +lava (5 min) |
| nobody can get hurt for a while | happening | happening | ✓ | Peace Day:  +peace (5 min) |
| make the ground super slippery | happening | happening | ✓ | Ice World: groundGrip ×0.1 (5 min) |
| a blood moon week | arc | arc | ✓ | blood_moon, 7 days |
| shooting stars every night for three nights | arc | arc | ✓ | meteors, 3 days |
| pirates attack the coast in three waves | scenario | scenario | ✓ | Pirates raid the coast in three waves. |
| an army of skeletons invades with a lich boss | scenario | scenario | ✓ | An army of skeletons invades in waves, led by a lich boss. |
| a little fishing village by the water | build | build | ✓ | Build a small fishing village beside the water, with docks, boats and cottages. |
| a castle on the hill | build | build | ✓ | Build a castle on top of a hill |
| make me a wizard | power | power | ✓ | Turn the player into a wizard with magic powers. |
| let me fly | power | power | ✓ | Give the player the power to fly. |
| give me the ability to breathe underwater | power | power | ✓ | Give the player the ability to breathe underwater. |
| sing me a song | unclear | unclear | ✓ | I can't sing in this world, sorry! But I could start a Harvest Festival with lanterns and fireworks, or bring you a cheerful songbird to keep you company. |
| asdfgh | unclear | unclear | ✓ | Hmm, that looks like a keyboard mash! Try something like "a friendly fox", "low gravity" or "build me a castle". |
