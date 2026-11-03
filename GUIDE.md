# The Last Meridian: the full guide

How everything in the game works. It names places and people you'll meet, but it doesn't say how the story ends. To get the game, see the [front page](README.md).

## How to play

Double-click **The Last Meridian** on your desktop or in the Start menu. The game opens in its own window, and it saves itself after every action. Close the window when you're done.

- **F11** switches to full screen and back.
- **Ctrl** with **+** or **-** makes everything bigger or smaller, and **Ctrl** with **0** puts it back.

If you've downloaded the source instead of the installer, you can play in your browser:

1. Double-click **`start-game.bat`**. A black window opens, and so does the game in your browser.
2. Keep the black window open while you play. Close it when you're done.

If the browser doesn't open, go to http://localhost:3210.

Only one copy of the game can run at a time, so they can't overwrite each other: whichever you open second joins the one that's already running.

At the prompt, type what you want to do, or the number of a listed choice. You can also click anything on screen.

The story can be written in advance, or written by an AI as you go: see [Who writes the story](#who-writes-the-story). Without an AI key, a new game uses the written story, which is free.

## Menus

The buttons down the right edge open the menus, grouped under **You**, **The story**, **The fleet**, **Gear** and **Game**. A menu slides out over the story and always takes up the same space: three quarters of the screen. To close one, press **Close** or Esc, click the story behind it, or click its button again. On a narrow window, press **Menu** instead, and the same groups run along the top. Inside a menu, the parts you don't need every time fold away behind a line like **[ + Fleet log ]**: click it to open them, and they stay open while the game's running. Rest the mouse on a button to see what its menu holds.

Each menu also has a command you can type:

| Command | Menu | What's in it |
|---|---|---|
| `/char` | Character | Level, your place and your job, condition, attributes, and your numbers in a fight |
| `/skills` | Skills | Every skill, your odds at each difficulty, your progress, and practice for each check window |
| `/traits` | Traits | Traits, convictions, and everything currently affecting you |
| `/perks` | Perks | What you've learned, what you can learn now, and what's locked |
| `/beliefs` | Beliefs | Where you stand on each axis, and your standing with each faction |
| `/dossier` | Your past | Your personal record, career and life history |
| `/people` | People | Everyone you've met or heard of |
| `/quests` | Quests | Active and finished quests, and the journal |
| `/leads` | Leads | Stories you could start here, what people are saying, and the stories you're following |
| `/codex` | What you know | Places, factions, ships and ideas you've come across, with a search box |
| `/inv` | Inventory | What you're carrying and wearing |
| `/ship` | Ship | The Meridian and its crew, with the way to the star map. Only if you're the captain |
| `/fleet` | Fleet | All 41 ships, supplies, rations, work crews and orders. If you aren't the captain, how things stand |
| `/map` | Star map | The chart of known space, with Set course, or Book passage if you aren't the captain |
| `/market` | Market | Buying and selling, where there's a market |
| `/bestiary` | Enemies met | Enemies you know of, their stats, why they fight, what you could try on them, and the simulator |
| `/settings` | Settings | Reading and display options, AI choice, saved games, and where your files are |

`/close` closes the open menu, and `/help` shows this list in the game.

## Fights

A fight opens in its own window over the story. Your side faces the enemy's, with each fighter drawn in console art beside their health and numbers, and your actions run down the sides of the window with your odds next to them.

The window is only as big as the fight needs: small for a duel, and bigger as followers join and the log fills. If your screen runs out of room, the actions move underneath the fighters and the log shrinks, so the buttons stay in view.

- **To act,** press a number or click an action. Each round then plays out one blow at a time, and you can click to skip ahead. If there are ten things to do, 0 is the tenth.
- **To aim,** click an enemy or use the left and right arrow keys. Your odds change to match that enemy's defenses.
- **Menus** still open during a fight, and slide over its window.
- **Difficulty:** **Fights** in the Settings menu goes from Easy to Hard, and applies from your next fight. Your followers stay the same, but enemies change. On Hard, someone who can't fight will usually lose to anything above a minor threat, unless they bring help or run.

**Talking instead of fighting.** Under **Another way** in the fight window are other things you can do with your turn. Each shows your chance of it working against whoever you're aiming at, and the chance changes as the fight goes on. Hover over one to see the sum.

| Option | What it uses | What it does |
|---|---|---|
| **Talk them down** | Persuasion, and Presence or whatever suits who you're talking to | They stop fighting and walk away. Their faction likes you a little more |
| **Threaten them**, or **Scare it off** for an animal | Intimidation, and Presence or Might | They back off, and their faction likes you less. How strong you are counts for more here |
| **Pay them off** | Commerce and Presence | They take the money and go, and it's worth half the XP. You only pay if they accept. The price is on the button |
| **Lie to them** | Deception, and Presence or Intellect | They believe you and go. If it fails, they won't believe anything else you say |
| **Shut it down** | Hacking and Intellect | For machines. It stops, but it isn't destroyed |
| **Back away slowly** | Survival, and Endurance or Perception | For animals. It loses interest |

Four things decide how hard it is, and a line under the fighters tells you how each stands for whoever you're aiming at:

- **How much they hate you.** It comes from how their faction feels about you and what you both believe, or from how they feel about you if they're someone you know. It can run from "They like you" to "They want you dead".
- **Why they're fighting.** Someone who's hungry is far easier to talk down than a true believer. Money works on a hired hand and not on someone who's sure they're right, and a forged order is the way past a soldier. Every kind of enemy has its usual reason, and the game master can give them a different one, in which case you'll read it in that line.
- **How strong you are.** The game works out how long each side would take to beat the other, from everyone's real numbers, so it changes with every hit. Nobody backs down when they're winning.
- **The stat that helps.** Your skill and your best stat for it are added to the roll. What helps with talking depends on who it is: you can show a hired hand the sums with Intellect, a Korrun respects Might, and someone desperate needs reading with Perception.

It takes your whole turn, and the enemies still get theirs. Your followers hold their fire while you do it. If it fails, they get angrier, so it's harder the next time. Once one of them has gone, the others are a little less sure of themselves, and more so if that was the one in charge. Anyone who walks away isn't beaten: you get the XP, but none of their money, and they're still out there, so the story decides what they do next. Machines can't be talked to or frightened, though a free synthetic can be reasoned with. The Choir isn't listening, and it's very hard to hack. The very worst enemies, the same ones you can't run from, can only be stopped by a fight.

**Give up** ends the fight on the spot, as long as there's someone there to give up to. You're not hurt any more than you already are, and the game master decides what they do with you. It costs you some stress, and it's never the end of the game.

**Followers:** either side can have followers if the story allows it, up to four fighters on a side, counting you. Some may come running partway through. Your followers fight by themselves, going after whatever you're aiming at, and they take a share of the XP. A follower who's knocked out stops fighting, and the story decides what became of them. If you fall, the fight is lost, even if your followers are still standing.

Fights run entirely on this computer, from the stats in the game's files. The AI only decides that a fight starts and who's in it. After that it isn't involved, so a fight costs nothing however long it lasts. When it ends, the story gets one line saying how it went, and nothing is sent to the AI until you choose **Continue the story** or type what you do next. Talking in a fight doesn't use the AI either.

To try a fight without the AI at all, use **Run in simulator** in **Enemies met**, aboard the Meridian, or **With followers** to have your crew and more enemies join in. Nothing that happens in the simulator carries over.

## Skill checks

When a choice has a check on it, or the game master asks for one, a window opens over the story, and each skill has its own. Hacking is a console session against a server, where you hunt for the password in a memory dump before the trace finds you. Medicine is a patient monitor. Piloting is a run through debris on a proximity radar. Persuasion is a conversation where you read the other person and pick your approach.

| Skills | What the window is |
|---|---|
| Hacking | Find the password in a memory dump before the trace completes |
| Science, Lore | Work out a hidden sequence, from how close each attempt gets |
| Engineering | Flip relays to get a whole panel live, when each one also flips its neighbors |
| Medicine, Survival, Composure | Keep three readings in the safe zone while events push them around |
| Piloting, Athletics | Pick your way down a corridor of obstacles, one move at a time |
| Stealth, Void Ops | Cross a map without stepping into anything's line of sight |
| Gunnery, Firearms | Aim where the target is going to be |
| Navigation | Plot the course with the least drift across a star chart |
| Tactics, Melee | Read what the other side is about to do, and answer it |
| Persuasion, Leadership, Streetwise | Bring someone around before they lose patience. With someone who has a file, what lands depends on what they really believe |
| Deception | Keep your cover story alive under questioning, by watching for tells |
| Intimidation, Manifestation | Push harder for a stronger result, and stop before it breaks |
| Commerce | Find their real price without insulting them |
| Awareness | Spot what's out of place in the picture |
| Attunement | Find where on the dial something comes through |

- **Your odds:** the bar at the bottom shows your chance of success, and it moves as you play. Your character's skill sets where it starts, and playing well can add up to 30%. When you're ready, the button beside the command line makes the final roll, at the odds showing. You can press it at any time.
- **Your training matters:** a better-trained character gets better tools in the window. A trained hacker's tools rule out wrong passwords, a good pilot can see further ahead, and a seasoned talker can tell what will land. Some perks and gear make the tools better still.
- **It's never a race:** nothing moves until you do, and everything can be clicked as well as typed. If you do type, part of a word is enough, and a typo won't cost you anything. Number keys pick commands, and the arrow keys work wherever there's a direction to choose.
- **It costs nothing:** the window runs entirely on this computer. The AI only hears the result, so a check from a choice takes one call to the AI rather than two.
- **To try them:** every skill in the **Skills** menu has a **Practice** button, and nothing in practice counts.
- **To skip them:** in **Settings**, set **Skill checks** to **Just a roll**, and checks go straight to the roll at your character's own odds.

## Who you are

You don't have to be the captain. The **Your place** step of creating a character has 22 lives to start from: **Captain of the Meridian**, which plays the way it always has, or one of 21 others, in the fleet or out in the world. You could be an engine-room hand on the Meridian, a dock hand at Haven Station, a miner at Cinder Reach, a card dealer on the Gilded Wheel, or a scavenger at the Pale Gate. **Surprise me** can land you in any of them. Games you've already started stay as the captain.

The life you pick decides where you start, who you know, where you stand with each faction, and your first quest. After that the world goes on over your head, and what you do about it is up to you. If you aren't the captain:

- **Someone else has the chair.** It's Captain Reddick, who's careful, Captain Marchetti, who's bold, or Captain Lund, who's somewhere between, and it's a different one from game to game. They're on the Meridian's Bridge like anyone else, and you can go and talk to them.
- **They really run the fleet.** They move it, buy what it needs out of its own money, set the work crews and answer raids, every day, on your computer, at no cost. It happens whether you're aboard or on the far side of the map. They can't save everyone: about 32 of the 41 ships are left after a hundred days, somewhere between 16 and 29 after two hundred, and by the end of a year it's down to the 14 named in the story.
- **The Fleet menu tells you what you'd know.** Aboard any ship in the fleet, or on the same dock as it, you see how it stands, what's been decided and the log. Anywhere else, you only get where it was last heard of. You can't give it orders, there's no **Ship** menu, and **Wait** just lets the time go by. The story only tells you about the fleet while you're with it, or if it's big news.
- **Getting around costs money.** The **Star map** shows a fare and a time instead of fuel, and **Book passage** takes you there by yourself, on whatever's going that way. The further and the more dangerous it is, the more it costs, and it's slower than a jump. A few places have no passage at all, because nobody goes there for ordinary reasons, so you'd need the story to get you there. Going aboard a ship in the fleet costs a fare too, unless the fleet's where you are.
- **You can work.** Where your job is, you'll find it under **Your place** in the **Character** menu, and under **You can** beside the room. A shift takes eight hours, wears you out, and pays a few credits, a little more as your skill improves.
- **You have to sleep somewhere.** It's free where you live and anywhere in the fleet. Anywhere else, you can rent a bunk for 6 credits, or sleep rough for nothing, which doesn't bring back your health or energy, and leaves you no calmer. Both are in the same two places as your job, and in **Condition** in the **Character** menu.
- **Leads are written for you.** Stories reach you the way they'd reach someone who isn't in charge. The 12 that only work for the captain, such as a court martial or the Commandant's request, stay closed, and the main story goes on around you.
- **It can change.** If the story gets there, the game master can hand you the chair, or take it away from you. The orders, the raids and the **Ship** menu then become yours, or stop being yours, and the fleet goes on from wherever it's got to.
- **It costs the same.** Passage, shifts, sleep and whoever's in the chair don't use the AI, and a turn with the game master costs what it always has.

## The fleet

The captain isn't only captain of the Meridian. They're responsible for 41 ships and 30,000 people, and those ships can run out of things. This section is how that works if the captain's you. If it isn't, someone else is doing all of this: see [Who you are](#who-you-are). All of this runs on this computer, so **nothing in the Fleet menu, the star map or a raid uses the AI or costs anything.** The story hears about what happened with your next message, in a line or two.

**Ships.** The **Ships** tab in the **Fleet** menu lists every ship, with its role, captain, people aboard, condition, and what it makes and uses up. A damaged ship makes less, and the filters show which ones are hurt, which ones make something, and which are gone.

**Supplies.** Food, fuel, medicine and parts are used up every day at midnight, in whatever way the day passes: sleeping, jumping, the story moving on, or you pressing **Wait**. The fleet starts with about two weeks of fuel, three and a half weeks of food and six weeks of medicine, unless you do something about it. You'll get a warning in the story when something's about five days from running out, and then:

| Runs out | What it does |
|---|---|
| Food | Morale and health fall fast, and you go hungry yourself, which costs you Endurance |
| Fuel | Nobody can jump, ships go cold, and crews work slower |
| Medicine | Health falls, people start dying, and your own wounds heal half as fast |
| Parts | Ships wear out three times as fast, and some break down for good |

**Morale and health.** Each settles toward a level set by your rations and work orders, and the Fleet menu shows you where. Low health kills people. Low morale makes crews slower, and when it stays very low, ships slip away in the night.

**The Choir.** The **pursuit** meter climbs every day, faster at dangerous places and slower at quiet ones. A jump shakes off some of it, and a longer jump shakes off more. When it fills, a raid window opens, and you choose: **Jump now** takes fuel, **Stand and fight** takes the Meridian's hull and parts, and **Scatter and regroup** costs morale, a day, and usually more ships. The likely losses and costs are on each button, and **Leave it to Commander Voss** lets her make the call, which goes on her record. Ships can be lost for good, along with many of the people aboard. In a raid, the ships named in the story's files can be crippled but not destroyed, and you can always scatter, whatever else you've run out of. Nothing here ends the game. It's a setback, and the story picks it up from there.

**Your decisions.** All of these are in the Fleet menu, and each shows its real cost and benefit before you choose:

- **Rations:** Generous, Standard, Reduced or Half. Less food used, against lower morale and health.
- **Work crews:** one job at a time, such as farm shifts, fuel skimming, repair gangs, scrounging, clinic duty, running silent, or standing down. Some of them gather what's around you, so where the fleet is matters: the Graveyard is good for parts, Tessen for food, and Cinder Reach for fuel.
- **Wait** a day or three, or make a **Blind jump** to shake off pursuit for 1 fuel.
- **Buy and sell** supplies for the fleet with your own credits, at places that deal in them. What they cost changes from day to day: see [The wider world](#the-wider-world).
- **Strip** a ship for parts and fuel. Her people are packed onto other ships, morale falls, and it can't be undone, so the game asks twice.

**The officers and the council.** If something's gone wrong and stayed wrong, they don't wait to be told. Quartermaster Brandt cuts rations when the food count gets low, Speaker Halm puts everyone on half rations when it's nearly gone, Chief Marrow sends the crews out for parts or fuel, Dr. Aduro pulls people onto clinic duty, Chief Hask sends the welders to the worst hulls, Father Roe speaks up for standing the fleet down when morale's very low, and Commander Voss makes a blind jump if the Choir's about to catch up, though not more than once a month. Each decision comes up in the story and in the **Officers and council** section of the Fleet menu.

They give you a day or two first, they make one decision a day, and an order of your own stands for a few days before they'd change it. You can overrule anything they do, and they put things back once the worst is over, but only what they changed themselves. If someone's been lost, the council does it instead. If you'd rather they didn't do any of this, press **Wait for my word**, and they won't, whatever happens.

**The star map.** Click any star to see the fuel and time it takes to get there, how dangerous it is, who controls it, and what you can gather or buy there, then press **Set course**. A jump moves the whole fleet and takes 1 to 3 fuel, depending on how far it is. The ships in your fleet, and wherever the fleet already is, are a short shuttle ride away. It runs here without the AI: the story line says where you've gone, and **Continue the story** brings in the game master when you're ready. You can still just say where you want to go, too.

## Walking around

**Story view** under **Reading** in the Settings menu switches between **Isometric**, where you see the room you're in from an angle, **Walk-around**, which is the same thing in console art, and **Classic**, where the story has the whole window. Isometric is the default. Isometric and Walk-around work everywhere in the world, and fights, skill checks, raids and menus are the same in all of them.

In Isometric and Walk-around, the main window shows the room you're in, with you standing in it. Every part of every place is its own level, with its own shape, colors and things in it. The Meridian's Bridge has its viewport and sensor pit, the bar at Haven has its weapons rack and its stain, the Long Furnaces at Korrath roar along both walls, the Gilded Wheel is one enormous wheel, and the 18:40 tram is still waiting on Founders Walk in Asterion. You arrive at each place by its way in, such as its docks. In Isometric the story comes up over the room: see [The story over the room](#the-story-over-the-room). In Walk-around it stays in a panel under the room, showing the latest scene, and **Show the whole story** opens all of it. Typing an action works the same way in all of them.

- **To walk,** click the floor, or use the arrow keys. You take the shortest way there. Walking doesn't use the AI.
- **To go to another room,** click a way out, such as `v The Names Bulkhead`, on the level or in the list beside it. Or press the button above that list, which has its own name in each place, such as **Deck plan**, **Station plan** or **Colony map**. It shows the whole place and who's in each room, and you click where you want to go.
- **Some ways in are closed,** and they show an `x` instead of an arrow: a guard, a locked door, a picket line. Click one to walk up to it and read why. **Ask to go through** goes to the story as your next action, so it's one AI turn, and the game master decides. If the story takes you through, that door stays open from then on, even after you've left and come back. Whatever's behind a closed door is closed too, on the map as well. There are 15 of these in the world, and none on the Meridian.
- **To talk to someone,** click them, on the level or in the list beside it. You walk up to them, and a talk window opens.
- **To look at something,** click a `?`, on the level or in the list beside it. **Look** is free. **Use** goes to the story as your next action, so it's one AI turn, the same as typing it.
- **When the story moves you,** the map follows, and people the story has with you stand beside you.
- **When the story goes somewhere that isn't on the map,** such as somewhere the game master has made up, that place gets a room of its own, drawn to suit: ducts look like ducts, a brig has bars, and a chapel has pews. The game master says what kind of room it is and what's in it that matters, and the room is kept with your campaign, so it stays the same if you come back. It's listed on the map of that place from then on.

**Isometric** is what the game looks like, seen from an angle the way Fallout is. It's the same rooms, people, clock and clicks as Walk-around, and everything above applies, except that the room is drawn instead of written out in characters.

- **To walk,** click the floor. Click anyone, a `?` or the name of a way out, and you walk over to it. The arrow keys still work, and they go along the room's own edges, so Up is up and to the right.
- **The camera** shows the whole room if there's room for it. If not, it stays with you, and the list beside the level has everything that's off the edge. The mouse wheel zooms in and out.
- **Walls at the front of a room** are cut down, so that they don't hide anyone.
- **The look** owes something to old isometric games like UnderRail: dark rooms, pools of colored light, gritty floors and walls, and clutter. It's only the style, though. None of their art is in here.
- **The game draws all of it by itself** from each level's file, with no art from anywhere else and no graphics engine, so anything you change in `world/maps/` shows up here too. It works out its own metal, concrete, rock, wood and rust. A mark's shape comes from what it is: `#` is a wall, `=` is a console or a bench, `[]` is a crate, `|` is a post, `~` is water, `%` is rock, scrap or crops depending on the place, and anything shut inside an outline stands up as one solid thing.
- **Lamps and fire:** lamps on the back walls throw pools of light on the floor, and a row of `*` on a plan is something burning, such as a furnace or a reactor. A `*` on its own is a star.

### The story over the room

In Isometric, the room gets the whole window and the story comes up over it, in the same console windows as the rest of the game.

- **A scene comes up a piece at a time.** Click anywhere, on the room or on the story, or press Space or Enter, to go on to the next piece. **Back** goes back. Nothing makes you read it all: you can pick a choice at any point.
- **What someone says** goes in a window over their head, in their color, and it writes itself out a letter at a time. A click finishes the line at once, and the next click goes on. If they're far away, the camera moves to keep them in view, and a long speech is cut into pieces that fit.
- **Narration** goes in the window along the bottom. So does anyone with no head in the room to put it over, such as a voice over comms or someone who isn't on the map.
- **Your choices** are in **What do you do?**, the same as ever: click one, or type its number, or type whatever you like. Typing is only there if you want it.
- **What's happening:** news, supplies and what your choices did come up as short lines at the top left and go away by themselves. Click one to dismiss it. They all stay in the whole story. A line waits for the piece of the story it goes with, so it doesn't give anything away, and time stops while a scene waits to be read, so the world's news comes while you're walking.
- **Walking puts the story away,** and the **Story** button brings it back, saying how many choices are waiting. **Close** or Esc does the same, and a new scene brings it back by itself. Until you've read to the end of a scene, a click on the room goes on with the story and doesn't walk anywhere, so to walk off in the middle of one, press **Close** or an arrow key.
- **Whole story** shows everything so far, in place of the room.
- **With less room,** such as in the smallest window, it's one thing at a time: narration goes away while someone's talking, and the choices wait until you've read to the end.
- **In a talk,** what people say writes itself out too. Click on it to finish it at once.

Under **Reading** in the Settings menu:

- **Story over the room:** **Popups** is all of the above. **One box** keeps everything in the window along the bottom, with nothing over anyone's head. **Under the room** puts the story back in a panel under the room, the way it is in Walk-around.
- **People's words:** how fast they write out: **Slow**, **Normal**, **Fast** or **All at once**.
- **Popup font:** **Terminal** matches the rest of the game, and **Book** is the one the story uses in Classic.
- **What each place is made of** and how it's lit is in `world/looks.json`: a cold blue Bridge, an orange furnace, red carpet at the Wheel. Change a word or a color there, and restart the game. It can also put one big thing in a room in place of what's on its plan, which is how the Great Wheel gets to be round.
- **It doesn't use the AI or change your save,** and the choice is kept with your other reading settings.

**The talk window** shows the person, how they feel about you, what's been said, and things you can click to say. You can type your own words instead if you'd like.

- **What it costs:** each thing you say is one call to the AI, and the window shows what the talk has cost so far. Opening a talk, closing it, and **Ask what they've heard** are free, and so are the written lines of someone with a written conversation, which are marked.
- **Time:** the clock stops during a talk, so talking can never use up a day in the fleet. The game refuses if the AI tries to pass time or move you, and sleeping and the Fleet menu's orders wait until you've closed the window.
- **Checks and fights:** if something you say leads to a skill check or a fight, its own window takes over, and the talk ends there.
- **Afterwards:** the story keeps one line about the talk, with **What was said** folded under it.

## People's lives

Everywhere in the world, people have a day of their own. In Isometric and Walk-around you can watch them get up, go to work, eat, walk around and go to bed, and they carry on whether you're watching or not. Aboard the Meridian that's the 13 crew you know, each with their own habits, and 24 others. In the other 23 places it's the 44 people you can meet there and 231 locals, such as dockers at Haven, kelp farmers at Maris Deep, the debtors in the Gilded Wheel's cellars and the monks who sit in shifts at Ilun. Each place keeps its own hours: the Remnant stands for the anthem at six, nearly everyone at the Wheel stops to watch it spin at eight in the evening, and at Vantor Prime they're home before the last chime. All of this runs on your computer, so it costs nothing, and it never uses the AI.

- **The clock** runs by itself while you explore. It's under the level, with buttons for **Pause**, **Normal**, **Fast** and **Faster**. A day in the game takes about two and a half hours at **Normal**, 24 minutes at **Fast**, and 5 minutes at **Faster**. This is time like any other: you get tired and your wounds heal as it goes by, and each midnight is another day of the fleet's food and fuel.
- **It waits for you.** It stops during fights, skill checks, raids and talks, while a menu or the map is open, while you're looking at something, when there's text in the typing line, and when the window is minimized. It stops after each new scene until you walk or press a speed, so you can read at your own pace. It also stops if you haven't touched the mouse or the keyboard for two minutes. In the Classic view it never runs by itself, and only the story moves it.
- **Who's in the room** is listed beside the level, with what each of them is doing. Click anyone to walk over and talk, even someone who's just a dim `o`. Someone asleep has to be woken up first. Someone who's on their way somewhere shows only their letter, and you can walk right past them.
- **The Hot Bunks** is the room where most of the Meridian sleeps, through a door on the Names Bulkhead. The map of each place shows how many people are in each room.
- **People go home.** At night a lot of people leave by a door and can't be found until morning, so a place can be nearly empty at three o'clock. You can wait, or press **Faster**.
- **The story knows about it.** The game master is told who's nearby and what they're doing. If the story brings someone over to you, they stay for a while, then go back to their day, from wherever they were standing.
- **Only where you are is walked step by step.** Everywhere else, people are simply where their day says they are whenever you turn up, which is why a whole world of them costs nothing.

## The wider world

Every place has its own supplies, prices and factions, and they change at each midnight, whether you're there or not. This runs on your computer too, and a whole year of it takes a fraction of a second.

- **Supplies:** food, fuel, medicine and parts each have a level at each place, shown as plenty, normal, short, scarce or almost gone. They drift up and down by themselves over days and weeks.
- **Places depend on each other.** Haven gets its fuel from Cinder Reach and the Deepyards, for example, so a strike at Cinder Reach means dearer fuel at Haven a few days later.
- **Prices follow the supplies.** The less there is of something, the more it costs, up to about three times the usual price, and when there's plenty it's cheaper. That goes for what the fleet buys in the Fleet menu and for what's made from it in the Market: a medkit costs more where medicine's short, and so does what you sell there.
- **Each lot you buy or sell moves the price,** so buying up everything gets expensive, and it can run out. Selling to a place that's short pays well, and it helps them. The fleet still needs what you sell, though.
- **Who holds a place** is worked out from how much of a say each side has there, which you can see on the star map. It shifts a little each day. Shortages get blamed on whoever's in charge, and things that happen move it further. A side that gets clearly ahead takes over, and you'll hear about it wherever you are. Some places can't change hands, such as Vantor Prime and Foundry Seven.
- **Whoever holds a place sets your prices there.** If they hate you, everything costs a quarter more, and if they like you, a little less.
- **Things happen,** each place with its own: raiders at Tessen, a fight on the picket at Cinder Reach, a bloom at Maris Deep, high season at the Gilded Wheel. Trouble makes a place one step more dangerous while it lasts.
- **News** is at the bottom of the **Star map** menu, for the places you know of. You're only told in the story about what's happening where you or the fleet are, or anything big. People also pass the latest on when you ask what they've heard.
- **The Star map** shows all of this for each place, and which supplies are short. The list of factions in the **Beliefs** menu says what each one holds.
- **The story knows about it.** The game master is told how things stand wherever you are, and hears the big news. When the story changes things, it can change them for real, so if you help the strikers take the Stack, they hold it from then on.
- **The rest:** the Choir's places, the Pale Gate, and the fleet's own ships have no daily supplies. The fleet's ships run on the fleet's own stores.

## Stories don't wait

The world isn't waiting for you. Each story has what happens if nobody steps in, and it happens at midnight on the day it comes round, on your computer, at no cost. Leave the strike at Cinder Reach alone, for example, and the hired men try the Gate, the strikers throw them back, and the fuel stops coming out.

- **It really changes things.** A story that moves on can change what a place has and who holds it, and it can cost the fleet morale, supplies, or ships.
- **Nothing's ever closed.** A lead that's moved on says how things stand now, and it's marked **it's moved on** in the **Leads** menu. You can still take it up from there, and the game master starts from how it stands.
- **Once you've taken a story up, it's in your hands,** and its clock stops.
- **Bigger stories start moving later,** and a story that follows another one opens once that one's finished or has run its course.
- **The main story moves too.** Its pressure builds with events of its own, and if nobody moves it on, it moves on to the next act by itself, as far as the fourth. The last one needs someone to take the fleet there.
- **You won't be swamped.** Only a few of these come up in the story at once. All of it is under **Moved on without you** in the **Leads** menu, and in the **News** on the **Star map**.
- **Every game's world goes at its own pace,** so you won't see the same things on the same days twice.

## Leads and the wider world

The **Leads** menu shows what you've heard about wherever you are: a few stories you could start, and what people are saying. Reading it costs nothing. **Look into this** starts that story, and **Ask around about this** follows up a rumor. Leads change as you travel and as time passes, and finishing one story can open another. They don't wait for you, either: see [Stories don't wait](#stories-dont-wait).

There's a lot more out there than the places you start out knowing about, and you'll hear about them as you go. The game master gets notes on each place and story only when they become relevant, so all of this barely changes what a turn costs. Every place you know of is on the **Star map**.

## Your files

The world is kept in files you can open with any text editor. Be warned that most of them contain spoilers, including everyone's secrets and how the whole story ends.

- `world/scenes/` has the written story, one plain text file for each scene: its parts, what each says, the choices, the checks and fights they lead to, the conditions on them, and what they change in the game. `talk_<id>.txt` is what that person says in a talk, and `arrive_<place>.txt` plays when the player arrives somewhere. `_how-to-write-a-scene.txt` there explains it all, including a thing's `used` and a door's `ask` in the map files, and the stock lines at the end of `rooms.json`. These are read again whenever the story needs them, so there's no restart. `npm run check-story` lists every mistake with its line, and `npm test` checks them too.
- `world/characters/` has one file for each important person, whether you've met them or not.
- `world/enemies/` has one file for each type of enemy, with its stats, why it usually fights (`motive`) and who for (`faction`). Against you, threat levels 2 and up fight harder than their files say, by the amounts in `FIGHT_DIFFICULTIES` in `src/combat.js`, depending on the difficulty you've chosen.
- `world/places/` has one file for each place: what it's like, who's there, what could happen and what people say.
- `world/threads/` has one file for each story that can come up, with its twist and where it can end up. `anyone` is how it reaches someone who isn't the captain, and a story without one stays the captain's own.
- `world/arc.json` is the main story: its acts, its clues and its endings.
- `world/fleet-events.json` has the small things that happen around the fleet.
- `world/fleet.json` has all 41 ships, what the fleet starts with, the ration levels, the work crews' orders, the rules for raids, and everything the fleet says in the story. A ship with `"story": true` is named in the story's files, so raids can hurt it but won't destroy it. `council` is what the officers and the council will do by themselves, and when. `chair` is how someone else in the captain's chair runs the fleet, with each captain's own habits.
- `world/starmap.json` has the star map: where each place is, how dangerous it is, who controls it, and what can be gathered or bought there, at its usual price. `fare` and `passage` are what it costs to go there on someone else's ship.
- `world/starts.json` has every life you can start from: where it starts, the job and what it pays, who you know, where you stand with each faction, your first quest, and what the game master is told about it. Instructions are at the top.
- `world/daily.json` has what changes at each place from day to day: where it gets its supplies, how much of a say each side has, how prices follow supplies, and everything that can happen there. Instructions are at the top.
- `world/story-clock.json` has what happens to each story if nobody steps in, day by day, and the main story's own events. Instructions are at the top. It's full of spoilers.
- `world/maps/` has one file for each place, with every room drawn in characters, which you can edit like a picture. Move a letter on a level to move a person or a thing. The file also has each room's colors, what each thing says when you look at it, what happens when you use it, what you can first say to each person, and which doors are closed. Instructions are at the top of `meridian.json`. A place with no file here just stays in the classic view.
- `world/life/` has one file for each place, with everyone's day: where they sleep, eat and work, and what they do at what time. Instructions are at the top of `meridian.json`. A place with no file here keeps its people at their posts, with no clock.
- `world/looks.json` has what each place and room is made of, and how it's lit, in the Isometric view. Instructions are at the top.
- `world/rooms.json` has the kinds of room the game can draw for anywhere that isn't on a map, such as ducts, a brig or a chapel, with the things you'd usually find in each. It also has what anyone can be asked in a talk, and how people look when you come over.
- `world/factions.json`, `world/items.json` and `world/perks.json` have the factions, items and perks added to the ones in `src/data.js`.
- `world/checks.json` has everything said in the skill check windows, and which game each skill uses.
- `world/combat-text.json` has everything that gets said in a fight.
- `world/parley.json` has everything about talking in a fight: every reason to fight and how much harder each makes each option, the options themselves, and what gets said. Instructions are at the top.
- `app/` has the app that the game runs in. See [The app](#the-app).
- `world/art.json` has the console art for fighters. Each figure is drawn facing right, and the game turns enemies around. A character's or enemy's `art` setting picks which figure they use.
- `data/campaigns/` has a folder for each campaign. When the game master adds someone important or a new type of enemy, they're saved here for good, and their stats are generated by the game. Rooms the story has invented are in its `rooms` folder, and you can give one its own drawing. `captain.json` is a readable copy of your character's stats, and changing it does nothing.

Saved copies of the same campaign share a folder, and a new game starts with an empty one. Restart the game after changing a file.

## Reading the story

- **People:** everyone who speaks gets their own name label and color, with a colored bar beside their words. Speech over comms has a dashed bar and looks like a transmission, machines look like machines, and the Choir sounds like nothing else.
- **Lore:** underlined words are people, places and ideas the game can explain. Hover over one for a summary, including how they feel about you or your standing with them. Click it to open a person's file in **People**, or anything else in the **Codex**, which fills up as you come across things. On a phone, tap the word.
- **Consequences:** a boxed **Consequence** in the story marks something that will come back later.
- **Results:** colored lines show what your choice actually did: checks, items, money, standing and beliefs. Green is good news and red is bad.
- **Choices:** tags before a choice show what it involves. `[PERSUASION 60%]` is your chance on a skill check, `[MERCY]` is the belief it expresses (red if it goes against your convictions), `[VOSS +]` or `[TARROW -]` means someone will approve or disapprove, and `[! costs 200 credits]` is a known cost or risk. Hover over a tag for details.

To change the story's font and size, use **Reading** in the Settings menu. **Book** is easiest on the eyes, and **Terminal** keeps the whole game in the console style. **Story font** is for Classic, the whole story and the panel under the room, and **Popup font** is for [the story over the room](#the-story-over-the-room). **Text size** goes for both. **Story view** is there too: see [Walking around](#walking-around).

**Display** in the Settings menu sets how big everything is, so the game fits your screen:

- **Interface size:** **Automatic** makes everything bigger in a bigger window, including the room, so it looks the same on any screen. At the size the app first opens (1400 by 900) and smaller, everything's drawn at its normal size. **Small**, **Normal**, **Large** and **Largest** set it yourself. A size can't go past what still fits in the window, so **Largest** in a small window is no bigger than **Normal**. Your choice is remembered.
- **Full screen:** press **Go full screen**, or F11 in the app. You can also pull the edges of the window to make it any size, and the screens rearrange themselves to fit.

## Creating your character

Press **New game** and pick **Build from scratch**, **Surprise me**, or a ready-made character you can still change. Building from scratch takes you through these steps:

1. **Identity:** name, pronouns and appearance. The AI uses all of it.
2. **Your place:** the captain, or one of 21 other lives. See [Who you are](#who-you-are).
3. **Species, homeworld and upbringing:** these set your starting attributes, skills, money and reputation.
4. **Attributes:** spend points on eight abilities. These decide your odds in the next step.
5. **Life simulation:** live your life in four-year terms, choosing a career each time. Each term rolls for survival and promotion, and gives you a decision to make. The choices shape your skills, beliefs, friends and enemies. Stop whenever you like. More terms mean more skills, but slower learning later, and aging starts to cost you after term 4. Your life ends at the Fall of the Concord.
6. **Skills:** spend points across 25 skills, and tag 3 that you'll improve faster.
7. **Traits:** choose strengths, paid for with points that flaws give back.
8. **Ideology:** set your beliefs on five axes. Strong beliefs become convictions, with real benefits and costs.
9. **Drive and bonds:** what you want most, and who you'd do anything for.
10. **Gear:** spend your savings. Whatever's left stays as credits.

Your life history, traits and beliefs go to the AI, so it can build the story around you.

## How the simulation works

- **Checks:** the AI picks a skill and a difficulty, then you play out the check in its own window. The game rolls a d20 and adds your attribute, skill, bonuses and what you earned in the window. You see the full breakdown each time.
- **Learning:** skills improve as you use them, as well as from the points you get when you level up.
- **Stress and fatigue:** frightening events and hard choices build stress, and time builds fatigue. Both give penalties when they get high, and enough stress causes a breakdown. Sleep to recover.
- **Injuries:** these have real penalties, and heal with time or treatment.
- **Beliefs:** your choices move your beliefs. Acting against a strong belief causes stress, and sharing a belief with someone helps your social checks with them.
- **The fleet:** a day's numbers are all worked out in one place, and the Fleet menu shows them, so what you read is what happens.

Saved games from before this system still load. They get a basic character profile, and you need to start a new game to use the creator. When you start a new game, your last one is kept as **Previous game** on the title screen.

## Who writes the story

**Who writes the story** in the Settings menu decides it for new games, and a game keeps what it started with:

- **Written story:** the story is written in advance, in plain text files in `world/scenes/`, so it's free and needs no AI. The choices are the ones on offer, and typing part of one is enough. What the story can't answer, it says so. For now that's the openings for three lives (the captain, an engine hand on the Meridian, and a dock hand at Haven Station), the fleet's arrival at Haven, the whole of the main plot's first act with every way through it written out, and one story aboard the Meridian. The first act is **The Warm Room** at Haven, **Two Weeks of Fuel** at Kessara Drift and Cinder Reach, **Visiting Hours** on Anselm's Mercy, and the council meeting, **Where We're Going**, which ends the act once the fuel's found and the council has voted. The Meridian's story is **The Downstairs Crew**. The **Leads** menu offers them where they happen, written ones first, and never leaves a written one off. Anyone else gets a short opening while theirs is written, and a smaller side of each story. Each scene file says at the top whether it's the AI's draft or the owner's own writing. In the Leads menu, a story that hasn't been written out yet says so instead of offering **Look into this**. Walking, people's lives, the wider world, fights, skill checks, the fleet and the menus all work as usual.
  - **People:** walk up to anyone and they speak first. The Meridian's crew each have a written conversation of their own (`world/scenes/talk_<id>.txt`), with things to say that lead on, questions that go away once asked, and answers that change with what the story has done. Everyone else has stock lines, made from who they are, what they're doing and where you are, plus what they've heard. Nothing in a talk uses the AI.
  - **Things and doors:** **Use** on a thing gives its written result or picks it up, and **Ask to go through** at a closed door follows that door's rule: some open when asked, some need something you've earned, and some open a skill check whose result decides. All 15 doors have a rule, and the bridge's things have results, with a plain answer anywhere that hasn't been written yet.
  - **Writing it yourself:** open a file in `world/scenes/` with Notepad, change it and save. The game reads it again the next time the story gets there, with no restart. `world/scenes/_how-to-write-a-scene.txt` explains the format: parts, choices, checks, fights, what a part changes, and conditions such as `? has data_chip` or `? skill persuasion >= 3` that decide which choices are offered and where the story goes. A choice can lead to a check whose pass and fail go different ways, a part can remember a flag for any later scene, a part can wait for the fleet to arrive somewhere, and a story can fill the fleet's tanks or move the main story on to its next act.
  - **Finding mistakes:** run `npm run check-story` in the game's folder. It lists every problem with the line it's on, in plain words, and changes nothing. A file the game can't read is explained in the game too.
- **AI game master:** the written parts play exactly as above, and they're still free. The three lives' openings, the arrival at Haven, the written stories and the crew's conversations come from their files, and clicking a choice costs nothing, which the choices say. The AI is the layer on top:
  - **Your own words.** Type anything in a written part and one call to the AI reads the part, the writer's notes for it and the choices on offer. It either takes the choice your words come to, with a sentence or two of its own to bridge them, and the story says how your words were taken, or it answers you in a few words without moving anything on, and the same choices come back. In a written part it can't change the story any other way: every other action is refused to it there. In a written conversation it's the same, in the person's voice.
  - **Everything that isn't written** is the AI's, as before: the other lives' openings, the stories the Leads menu hasn't got written out, people without a conversation of their own, and things without a written result. The AI is told what the written story played, so it carries on from where the written part left off.
  - It needs a key or a local model, as below. Adding this to the AI's instructions makes it reload your story once, the next time it writes.

Until you choose, a new game uses the written story if no AI is set up, and the AI game master if one is. A game that an AI has been writing can't switch to the written story, because the written story wouldn't know what happened in it.

## Choosing your AI

Open the **Settings** menu in the game. You can switch at any time, even in the middle of a story.

### Claude (online, costs a little per turn)

1. Go to https://console.anthropic.com, create an account and add some credit. This is billed separately from a Claude subscription.
2. Under **API keys**, create a key and copy it.
3. In the game, paste it into **Settings**, then press **Save key**.

The key is saved in plain text in `data/settings.json` on this computer, and is only ever sent to Anthropic. Don't share that file.

| Model | Good for | Rough cost per turn* | Starting a session* |
|---|---|---|---|
| Claude Opus 5.5 | Best writing and story memory | 5 to 8 cents | About 20 cents |
| Claude Sonnet 5.5 | A good balance | 3 to 4 cents | About 10 cents |
| Claude Haiku 5.5 | Speed and low cost, but looser with the story format | Well under 1 cent | About half a cent |

*The Opus and Haiku costs were measured in a real test at the start of a story. The Sonnet costs are worked out from its prices. You can see your real spending at console.anthropic.com.

Starting a session costs more because Claude has to load the game's rules and your story so far into its memory. That memory lasts an hour from your last turn, so pausing costs nothing until then. Fights and menus don't use the AI, so they cost nothing.

After a break of more than an hour, Claude has to load everything again. Once a story has grown long, it starts from a record instead, because that costs far less: your journal, the codex and your last 24 story entries, word for word. Older scenes then live on through the journal.

**A line in a talk** is much shorter than a story turn, so it costs less: about 1 to 2.5 cents on Opus and under a tenth of a cent on Haiku, worked out from the real calls in `data/usage.jsonl`. It's most of what a turn costs to have Claude read back a long story, so these go up slowly as the story grows.

**Watching and lowering the cost:** the top bar shows what your last turn cost, and the **Settings** menu shows your totals. To spend less, set **Claude's thinking** to **Low** in Settings, or choose a cheaper model. Low costs less per turn, but Claude may be less careful with the story and the rules, so try it and see whether you like it. Changing it makes Claude reload your story once.

### A local model (free and private, but weaker writing)

1. Install Ollama from https://ollama.com.
2. Open a terminal and download a model that supports game actions:

   ```bash
   ollama pull qwen2.5:14b
   ```

3. In the game, open **Settings**, press **Refresh list**, then choose the model.

The download is several GB. Local models make more mistakes with game actions than Claude does.

## Changing the game

- `world/` holds the characters, enemies, places, stories and game text, as described under [Your files](#your-files). These are the safest files to edit.
- `src/data.js` holds the items, perks, locations and story background. Restart the game after you change it.
- `src/character-data.js` holds the skills, species, origins, traits, beliefs and ready-made characters.
- `src/life-data.js` holds the careers and everything that can happen in the life simulation.
- `src/lore.js` holds the entries of **What you know**. Only put what your character would know in there, because players can read it.
- `src/creator.js` works out a character from the choices made in the creator, and `src/role.js` works out who that makes them in the world, and what the game master is told about it.
- `src/rules.js` holds the rules: dice, leveling, stress and beliefs.
- `src/combat.js` holds the rules for fights, including talking in them, and `public/fight.js` draws the fight window.
- `src/fleet.js` runs the fleet day by day, and `public/fleet.js` draws the Fleet menu, the star map and the raid window.
- `src/walk.js` runs walking around, the levels, where you are, and talks. `public/walk.js` draws the levels, the clock's buttons and the map of each place, `public/iso.js` draws the isometric view, `public/popups.js` draws the story over the room, with `public/scene.js` cutting each scene into pieces and `public/writer.js` writing people's words out, and `public/talk.js` draws the talk window.
- `src/life.js` runs everyone's days, and how they get around. `src/daily.js` runs each place's supplies, prices and factions, day by day. `src/story-clock.js` moves the stories on when nobody has stepped in. None of them has any screens, and none of them uses the AI.
- `src/checks.js` runs the skill check windows, `src/check-games/` has the game behind each one, and `public/check.js` draws them.
- `src/story-library.js` decides which leads, rumors and notes the player and the game master get.
- `src/scenes.js` plays the written story from `world/scenes/`, through the same tools, checks and fights as the AI, and checks the scene files. `src/scene-text.js` reads the text format, its conditions and its effects, `src/talks.js` plays written conversations and makes stock ones, and `src/check-scenes.js` is the `npm run check-story` command.
- `src/npc.js` generates the stats of anyone the AI adds, and `src/campaign.js` saves them to their files.
- `src/tools.js` lists what the AI is allowed to do, and the limits on it.
- `src/ai.js` holds the AI's instructions and the connection to it.
- `public/story.js` and `public/story-view.js` turn the AI's text into what you see in the main window.
- `public/menus.js` holds what's inside each menu.
- `data/saves/` holds your saved games.
- `data/usage.jsonl` records what each call to Claude cost.

To check that the rules still work after a change, run:

```bash
npm test
```

## The app

The installer gives the game its own window, with shortcuts on your desktop and in the Start menu. It holds its own copy of the game, so you don't need anything else installed.

- **Where your things are:** your saved games, your settings and your API key are in `%APPDATA%\The Last Meridian\data`, which is what `data/` means in this guide if you used the installer.
- **A new version:** run the newer installer. It replaces the game and leaves your saves alone.
- **If something goes wrong:** what the game printed is in `%APPDATA%\The Last Meridian\game.log`.
- **Uninstalling:** use **Installed apps** in Windows Settings. That only removes the game. Your saves and API key stay until you delete `%APPDATA%\The Last Meridian` yourself.
