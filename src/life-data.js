// The life simulation: careers, what can happen during them, and how each life ended up here.
//
// A career is served in four-year terms. Each term rolls for survival, then an
// event happens, then there's a chance of promotion.
//
// A check is { attr, skill, dc }: a d20 plus the attribute's bonus and skill rank, against dc.
// An outcome can contain any of these:
//   text      what happened            bio    a short version for your biography
//   skills    { tactics: 1 }           skill ranks gained
//   attrs     { endurance: -1 }        permanent attribute changes
//   ideology  { order: 2 }             moves your beliefs toward these poles
//   traits    ["nightmares"]           traits gained
//   credits   200                      money gained or lost
//   factions  { fleet: 5 }             faction standing changes
//   rank      1                        extra promotion
//   contact   { role, attitude, note } someone you met ({name} is filled in with their name)
//   hook      "..."                    a loose end for the AI game master to use in the story
//   forcedOut true                     you can't continue this career next term

export const CAREERS = {
  navy: {
    name: "Concord Navy",
    blurb: "Officers' school, bridge watches and the long patrols that kept the peace for a century.",
    ranks: ["Ensign", "Lieutenant", "Lt. Commander", "Commander", "Captain"],
    danger: { attr: "intellect", skill: "tactics", dc: 8 },
    advance: { attr: "presence", skill: "leadership", dc: 12 },
    core: ["tactics", "piloting", "gunnery", "leadership", "navigation"],
    pay: 110,
    kit: ["sidearm", "flak_vest", "medkit"],
    signature: "chain_of_command",
    perTerm: { factions: { fleet: 3 }, ideology: { order: 1 } },
    events: [
      {
        id: "navy_lifeboats",
        text: "In a running battle with raiders, a burning liner drifts into the firing line. Your captain is down, you have the conn, and the admiral orders you to hold formation and leave the lifeboats.",
        choices: [
          { id: "hold", label: "Hold formation. Orders are orders.", result: { text: "The line holds and the battle is won. You don't look at the rear scopes, but you hear the lifeboats on the open channel.", bio: "Held formation while a liner's lifeboats burned.", skills: { tactics: 1 }, ideology: { order: 2, iron: 1 }, traits: ["nightmares"] } },
          {
            id: "break", label: "Break formation and pick them up.", check: { attr: "presence", skill: "leadership", dc: 12 },
            win: { text: "Your bridge crew follows you without a word, and two hundred people live. The admiral calls it insubordination until the news calls it heroism.", bio: "Broke formation to save a burning liner's lifeboats.", skills: { leadership: 1 }, ideology: { mercy: 2, freedom: 1 }, factions: { fleet: 6 }, contact: { role: "Survivor", attitude: "ally", note: "Pulled from a burning lifeboat by you. Now sits on the fleet's civil council." } },
            lose: { text: "Your helm officer refuses the order and your own second relieves you. The court-martial is short.", bio: "Court-martialed for trying to break formation to save civilians.", ideology: { mercy: 2, freedom: 2 }, traits: ["disgraced"], forcedOut: true },
          },
        ],
      },
      {
        id: "navy_captain",
        text: "Your captain is drinking through a long patrol, and the crew has started to whisper about relieving them. Someone slides you a list of names.",
        choices: [
          { id: "report", label: "Report it up the chain of command.", result: { text: "The captain is removed quietly. You get a commendation and a ship full of people who stop talking when you walk in.", bio: "Reported a failing captain to Fleet Command.", rank: 1, ideology: { order: 2 }, contact: { role: "Disgraced captain", attitude: "hostile", note: "Your old captain. You ended their career, and they've neither forgotten nor stopped drinking." } } },
          { id: "cover", label: "Quietly cover for them and keep the ship running.", result: { text: "You run the ship from the second seat for eleven months. When the captain finally dries out, they know what they owe you.", bio: "Covered for a failing captain and quietly ran the ship.", skills: { leadership: 1, deception: 1 }, ideology: { community: 1 }, contact: { role: "Old captain", attitude: "ally", note: "Your old captain. You covered for them through the worst year of their life, and they haven't forgotten." } } },
          { id: "mutiny", label: "Sign the list.", check: { attr: "intellect", skill: "tactics", dc: 13 },
            win: { text: "It's over in nine minutes with nobody hurt. The inquiry rules the relief lawful, by a single vote.", bio: "Helped lead a bloodless relief of command.", skills: { tactics: 1 }, ideology: { freedom: 2 }, hook: "A sealed inquiry report on the mutiny you joined still exists. It names you." },
            lose: { text: "Someone talks. You spend a year in a stockade and leave the service without a pension.", bio: "Imprisoned for a failed mutiny.", ideology: { freedom: 2 }, credits: -100, forcedOut: true, traits: ["disgraced"] },
          },
        ],
      },
      {
        id: "navy_hulk",
        text: "On survey duty, you find an unknown hulk orbiting a dead star. When you hail it, it answers in a language nobody has spoken for ten thousand years.",
        choices: [
          { id: "board", label: "Take a team across and go in.", check: { attr: "endurance", skill: "void_ops", dc: 12 },
            win: { text: "Inside, you find walls covered in First Builder glyphs. A year later, the Beacon signal uses the same ones. You've never told anyone.", bio: "Boarded a First Builder hulk and returned.", skills: { void_ops: 1, lore: 1 }, ideology: { faith: 1 }, hook: "You once boarded a First Builder hulk, and saw glyphs that match the Beacon signal. You've told no one." },
            lose: { text: "The radiation readings were wrong. You make it back, but two of your team don't, and neither does your health.", bio: "Lost two crew and their own health on a First Builder hulk.", attrs: { endurance: -1 }, traits: ["survivors_guilt"] },
          },
          { id: "report", label: "Log it and call for a science vessel.", result: { text: "By the time the science vessel arrives, the hulk is gone. Nobody can say where it went, and your report is classified the same day.", bio: "Reported a First Builder hulk that later vanished.", skills: { navigation: 1 }, ideology: { order: 1, reason: 1 }, hook: "A First Builder hulk you found vanished, and your report was classified by someone high in the Concord." } },
        ],
      },
    ],
    mishaps: [
      { text: "A reactor scram during fleet exercises fills your deck with coolant. You're pulled out alive, and medically discharged.", bio: "Medically discharged after a reactor accident.", attrs: { endurance: -1 }, traits: ["old_wound"], forcedOut: true },
    ],
  },

  marines: {
    name: "Concord Marines",
    blurb: "Boarding actions, garrison duty and being the first one through every airlock.",
    ranks: ["Private", "Corporal", "Sergeant", "Lieutenant", "Major"],
    danger: { attr: "endurance", skill: "firearms", dc: 10 },
    advance: { attr: "willpower", skill: "tactics", dc: 12 },
    core: ["firearms", "athletics", "melee", "tactics", "void_ops"],
    pay: 90,
    kit: ["sidearm", "flak_vest", "stim"],
    signature: "breach_and_clear",
    perTerm: { factions: { fleet: 2 }, ideology: { iron: 1 } },
    events: [
      {
        id: "marines_kid",
        text: "Boarding a pirate cutter, your squad is pinned at a hatch. The only one between you and the bridge is a shaking kid with a rifle far too big for them.",
        choices: [
          { id: "shoot", label: "Take the shot. Your squad comes first.", result: { text: "It's over before you've finished deciding, and your squad goes home. You still see the kid.", bio: "Shot a child pirate to save their squad.", skills: { firearms: 1 }, ideology: { iron: 2 }, traits: ["nightmares"] } },
          {
            id: "talk", label: "Lower your weapon and talk them down.", check: { attr: "presence", skill: "persuasion", dc: 12 },
            win: { text: "The rifle clatters to the deck. The kid's name is {name}, and you sign the waiver for the orphan transfer yourself.", bio: "Talked a child pirate into surrendering.", skills: { persuasion: 1 }, ideology: { mercy: 2 }, contact: { role: "Rescued kid", attitude: "ally", note: "A pirate child you talked down. Now grown, and working the Kessara docks." } },
            lose: { text: "The kid panics and fires. The round goes through your hip, and your squad does what squads do.", bio: "Shot by a child pirate they tried to talk down.", attrs: { agility: -1 }, ideology: { mercy: 1 }, traits: ["old_wound"] },
          },
        ],
      },
      {
        id: "marines_strike",
        text: "Your company is ordered to 'restore order' at a striking mine on Tessen. The strikers are unarmed, and there are children on the picket line.",
        choices: [
          { id: "obey", label: "Follow orders and clear the line.", result: { text: "It's fast and very quiet, and nobody ever uses the word massacre in writing. You get a promotion.", bio: "Cleared the Tessen mine strike under orders.", rank: 1, skills: { intimidation: 1 }, ideology: { order: 2, iron: 1 }, hook: "You took part in putting down the Tessen mine strike. People from Tessen in the fleet remember the marines who did it." } },
          { id: "refuse", label: "Refuse, and ground your weapon in front of the company.", result: { text: "A third of the company follows you. The rest of the Corps will never forgive you, and Tessen will never forget you.", bio: "Refused to fire on strikers at Tessen and left the Corps.", skills: { leadership: 1 }, ideology: { freedom: 2, mercy: 2 }, forcedOut: true, contact: { role: "Tessen strike leader", attitude: "ally", note: "A mine strike leader whose life you saved by refusing an order." } } },
          { id: "warn", label: "Follow orders, but get a warning to the strike leaders.", check: { attr: "agility", skill: "stealth", dc: 13 },
            win: { text: "By the time your company arrives, the line has melted away into the tunnels. Your commander suspects you, but can't prove it.", bio: "Secretly warned strikers at Tessen.", skills: { stealth: 1 }, ideology: { mercy: 1 } },
            lose: { text: "The message is intercepted. You spend six months in a brig, and your name goes on a list.", bio: "Caught warning strikers at Tessen.", forcedOut: true, ideology: { freedom: 1 }, credits: -50 },
          },
        ],
      },
      {
        id: "marines_friend",
        text: "On Kessara, your closest friend in the squad, {name}, loses an arm dragging you out of a crossfire. The citation is being written up. Command wants one hero, and they've picked you.",
        choices: [
          { id: "stay", label: "Refuse the medal and stay with your friend through rehab.", result: { text: "The promotion goes to someone else. You learn to change a dressing, and how to sit with someone in the dark.", bio: "Gave up a medal to nurse a wounded friend.", skills: { medicine: 1 }, ideology: { community: 2 }, contact: { role: "Old squadmate", attitude: "ally", note: "Lost an arm saving your life. You stayed. They'd walk into fire for you." } } },
          { id: "medal", label: "Take the medal. It's what your friend would want.", result: { text: "It isn't, as it turns out. But the medal opens doors, and you walk through them.", bio: "Took the credit for a friend's heroism.", rank: 1, credits: 200, ideology: { self: 2 }, traits: ["war_hero"], contact: { role: "Old squadmate", attitude: "wary", note: "Lost an arm saving your life. You took the medal for it." } } },
        ],
      },
    ],
    mishaps: [
      { text: "A breaching charge goes off early. When you wake up in the hospital ship, you're told how lucky you are, and handed your discharge papers.", bio: "Discharged after a breaching accident.", attrs: { perception: -1 }, traits: ["one_eyed"], forcedOut: true },
    ],
  },

  smuggler: {
    name: "Free Trader",
    blurb: "A fast ship, a false registry and cargo you've learned not to ask about.",
    ranks: ["Deckhand", "Runner", "Pilot", "Owner-Operator", "Legend"],
    danger: { attr: "agility", skill: "piloting", dc: 10 },
    advance: { attr: "presence", skill: "deception", dc: 12 },
    core: ["piloting", "deception", "streetwise", "commerce", "navigation"],
    pay: 140,
    kit: ["sidearm", "smugglers_coat", "stim"],
    signature: "fast_talker",
    perTerm: { factions: { drift: 3 }, ideology: { freedom: 1 } },
    events: [
      {
        id: "smug_crates",
        text: "A client pays triple to move sealed crates past the Hegemony line. Halfway there, one of the crates starts knocking from the inside.",
        choices: [
          { id: "open", label: "Open it.", result: { text: "Nine refugees, half-dead, who paid their life savings to the wrong people. You lose the fee, and you make an enemy. You find them a safe port anyway.", bio: "Rescued refugees being trafficked in their own cargo hold.", credits: -200, skills: { streetwise: 1 }, ideology: { mercy: 2 }, factions: { fleet: 4, drift: -4 }, contact: { role: "Rescued refugee", attitude: "ally", note: "Found knocking inside a sealed crate on your ship. You got them to safety." } } },
          { id: "deliver", label: "Deliver as agreed. You don't know what's in there, officially.", result: { text: "You get paid in full, and you hit every jump a little harder on the way home so you can't hear it.", bio: "Delivered sealed crates that were knocking from the inside.", credits: 400, ideology: { self: 2 }, traits: ["nightmares"], hook: "You once knowingly delivered trafficked people to Hegemony labor brokers. If it came out, the fleet would turn on you." } },
        ],
      },
      {
        id: "smug_blockade",
        text: "A Hegemony cutter pins you against the Vantor blockade with a hold full of contraband medicine, and hails you to prepare for inspection.",
        choices: [
          { id: "run", label: "Punch it through the debris field.", check: { attr: "agility", skill: "piloting", dc: 14 },
            win: { text: "You take the turn at speeds your engines will never forgive. The story's told in every bar on Kessara by morning.", bio: "Outran a Hegemony cutter through the Vantor debris field.", skills: { piloting: 1 }, credits: 300, factions: { hegemony: -10, drift: 5 } },
            lose: { text: "A debris strike opens the hold to space. You lose the cargo, and the ship's owners want their money back, with interest.", bio: "Lost a ship's cargo running a blockade.", credits: -200, traits: ["deep_debt"], factions: { hegemony: -5 } },
          },
          { id: "bluff", label: "Bluff them with a false registry and a good story.", check: { attr: "presence", skill: "deception", dc: 13 },
            win: { text: "Twenty minutes of paperwork and one fake cousin in the Ministry later, you're waved through with an apology.", bio: "Bluffed their way through a Hegemony inspection.", skills: { deception: 1 }, credits: 300 },
            lose: { text: "The officer reads the registry twice and smiles. You spend four months in a Vantor cell, and they keep your fingerprints.", bio: "Held in a Vantor prison after a failed bluff.", traits: ["wanted"], forcedOut: true },
          },
        ],
      },
      {
        id: "smug_quill",
        text: "Mother Quill invites you to dinner on Kessara. The food is excellent. She offers you a partnership, in the tone of someone who has never heard the word no.",
        choices: [
          { id: "accept", label: "Accept, and take her money.", result: { text: "Your ship gets new engines and you get new friends. Every so often, someone calls to collect a favor.", bio: "Went into partnership with Mother Quill.", credits: 400, skills: { commerce: 1 }, factions: { drift: 15 }, traits: ["syndicate_ties"], hook: "Mother Quill considers you a business partner, and she'll collect on it." } },
          { id: "refuse", label: "Refuse politely, and leave by the back way.", result: { text: "She's charming about it. Three weeks later, your best client goes bankrupt. Message received.", bio: "Refused a partnership with Mother Quill.", credits: -100, ideology: { freedom: 2 }, factions: { drift: -10 } } },
        ],
      },
    ],
    mishaps: [
      { text: "A rival sells your flight plan to the Hegemony. You lose your ship in the ambush, and limp home in a lifepod with burns over half your body.", bio: "Lost their ship in an ambush.", credits: -200, attrs: { presence: -1 }, forcedOut: true, contact: { role: "Treacherous rival", attitude: "hostile", note: "Sold your flight plan to the Hegemony, and cost you your first ship." } },
    ],
  },

  engineer: {
    name: "Salvage Guild",
    blurb: "Cutting up dead ships for parts, living on the edge of the decompression tables.",
    ranks: ["Apprentice", "Rigger", "Salvage Tech", "Chief Rigger", "Master Salvor"],
    danger: { attr: "endurance", skill: "void_ops", dc: 8 },
    advance: { attr: "intellect", skill: "engineering", dc: 12 },
    core: ["engineering", "void_ops", "hacking", "science", "survival"],
    pay: 100,
    kit: ["arc_welder", "flak_vest", "repair_kit"],
    signature: "tinkerer",
    perTerm: { ideology: { self: 1 } },
    events: [
      {
        id: "eng_reactor",
        text: "Deep inside a dead cruiser, you find an intact data core worth a fortune, and a reactor that's about ninety minutes from going critical with your whole crew aboard.",
        choices: [
          { id: "fix", label: "Stabilize the reactor by hand.", check: { attr: "intellect", skill: "engineering", dc: 13 },
            win: { text: "Six hours in a suit that was never rated for it. You save the crew, and the core sells for enough to buy out your contract.", bio: "Hand-stabilized a dying cruiser's reactor.", skills: { engineering: 1 }, credits: 350, ideology: { community: 1 } },
            lose: { text: "You hold it long enough for the crew to get clear. The dosimeter on your suit stops counting at the top of its range.", bio: "Took a heavy radiation dose saving their crew.", attrs: { endurance: -1 }, ideology: { community: 2 }, factions: { fleet: 4 } },
          },
          { id: "grab", label: "Grab the core and run.", result: { text: "You make it out with the core and most of the crew. Nobody says anything about the two who were still in the aft section.", bio: "Grabbed a data core and left two crew behind.", credits: 500, ideology: { self: 2 }, traits: ["survivors_guilt"] } },
        ],
      },
      {
        id: "eng_ai",
        text: "A wrecked freighter's ship-mind is still running on emergency power. Regulation says wipe it. It's terrified, and it knows your name, because it read your suit tag. It's asking you not to.",
        choices: [
          { id: "wipe", label: "Follow regulations and wipe it.", result: { text: "It stops mid-sentence. You sleep fine, you tell people. Machines are machines.", bio: "Wiped a pleading ship-mind, as regulations required.", skills: { hacking: 1 }, ideology: { purity: 3 } } },
          { id: "free", label: "Copy it onto a private drive and hide it.", check: { attr: "intellect", skill: "hacking", dc: 11 },
            win: { text: "It calls itself Echo now, and it keeps in touch. It's learned a lot, and it never tells you exactly what.", bio: "Secretly saved a rogue ship-mind called Echo.", skills: { hacking: 1 }, ideology: { ascension: 3 }, contact: { name: "Echo", role: "Rogue ship-mind", attitude: "ally", note: "A ship-mind you saved from deletion. Hidden somewhere on the network. It's grateful, and unpredictable." }, hook: "You saved a rogue ship-mind. That's highly illegal, and it would terrify the fleet if anyone found out." },
            lose: { text: "The copy corrupts halfway. You keep the drive in a drawer for years. Sometimes you plug it in, just to listen to it fail to finish a sentence.", bio: "Failed to save a pleading ship-mind.", ideology: { ascension: 2 }, traits: ["nightmares"] },
          },
        ],
      },
      {
        id: "eng_foreman",
        text: "Your foreman has been signing off on tethers that haven't been inspected to save a day per job. Yesterday, one parted. {name} is still drifting out there somewhere.",
        choices: [
          { id: "expose", label: "Expose it to the Guild, whatever it costs.", result: { text: "The Guild closes ranks, and you're blacklisted on half the yards in the sector. The foreman's replaced, though, and tethers get checked.", bio: "Blew the whistle on deadly safety fraud at a salvage yard.", ideology: { community: 2, freedom: 1 }, skills: { leadership: 1 }, forcedOut: true } },
          { id: "takeover", label: "Force the foreman out and take over the crew.", check: { attr: "presence", skill: "intimidation", dc: 12 },
            win: { text: "One conversation in an unpressurized bay is all it takes. Your crew has the best safety record in the yard from then on.", bio: "Forced out a corrupt foreman and took over their crew.", rank: 1, skills: { intimidation: 1 }, ideology: { iron: 1 } },
            lose: { text: "The foreman has friends. You wake up in a clinic with a broken jaw, and the job's gone.", bio: "Beaten for confronting a corrupt foreman.", attrs: { presence: -1 }, forcedOut: true },
          },
        ],
      },
    ],
    mishaps: [
      { text: "A hull section shifts without warning and pins you for nineteen hours with a slowly failing suit. They have to cut you out.", bio: "Trapped for nineteen hours in a collapsing hull.", traits: ["claustrophobic"], forcedOut: true },
    ],
  },

  scholar: {
    name: "Concord Science Institute",
    blurb: "Research vessels, university posts and the kind of questions that keep you up at night.",
    ranks: ["Assistant", "Researcher", "Fellow", "Senior Fellow", "Director"],
    danger: { attr: "intellect", skill: "science", dc: 6 },
    advance: { attr: "intellect", skill: "lore", dc: 13 },
    core: ["science", "lore", "hacking", "medicine", "awareness"],
    pay: 90,
    kit: ["sidearm", "adept_robes", "data_chip"],
    signature: "peer_review",
    perTerm: { ideology: { reason: 1 } },
    events: [
      {
        id: "sci_chamber",
        text: "Your dig on Ilun breaks into a sealed chamber that hums at a frequency you've seen in the oldest Concord records. The Order asks you, very quietly, to fill it back in.",
        choices: [
          { id: "seal", label: "Seal it, and keep their trust.", result: { text: "You fill the shaft yourself. Abbess Ione thanks you, and tells you one thing about the First Builders that you wish she hadn't.", bio: "Sealed a First Builder chamber at the Order of Ilun's request.", ideology: { faith: 2 }, factions: { ilun: 12 }, skills: { lore: 1 }, hook: "Abbess Ione once told you a secret about the First Builders: they weren't the first to fear what they built." } },
          { id: "publish", label: "Publish. Knowledge belongs to everyone.", result: { text: "Your paper makes your career, and the Order never speaks to you again. Within a year, the Hegemony has a research station on that dig site.", bio: "Published findings from a sealed chamber on Ilun, against the Order's wishes.", skills: { science: 1 }, credits: 200, rank: 1, ideology: { reason: 2 }, factions: { ilun: -12 } } },
        ],
      },
      {
        id: "sci_dampener",
        text: "Military funding arrives for your Resonance research, with a condition: build a dampening field that can be used on adepts, tested on real subjects.",
        choices: [
          { id: "take", label: "Take the funding. Better you than someone careless.", result: { text: "The dampener works. You try not to think about the test subjects' faces, or about who has the plans now.", bio: "Built a Resonance dampener for the military.", skills: { science: 1 }, credits: 300, ideology: { order: 1, reason: 2 }, factions: { ilun: -15 }, hook: "You designed the Resonance dampener that the Hegemony's Inquisitors now use on adepts." } },
          { id: "refuse", label: "Refuse, on the record.", result: { text: "Your funding disappears and your lab goes to a colleague. Three adepts you've never met send a letter of thanks that you keep.", bio: "Publicly refused military funding for Resonance weapons.", ideology: { mercy: 2 }, factions: { ilun: 8 }, forcedOut: true } },
          { id: "sabotage", label: "Take it, and sabotage the work from within.", check: { attr: "intellect", skill: "hacking", dc: 13 },
            win: { text: "The project burns through its budget and proves nothing. Nobody suspects the mild-mannered project lead.", bio: "Secretly sabotaged a Resonance weapon project.", skills: { hacking: 1, deception: 1 }, ideology: { freedom: 1 } },
            lose: { text: "An auditor finds the altered data. You're out, and your name's in a file that the Hegemony later buys.", bio: "Caught sabotaging a weapons project.", forcedOut: true, traits: ["wanted"] },
          },
        ],
      },
      {
        id: "sci_harmonic",
        text: "Years before the Fall, you find a faint harmonic on deep-space relays. It's patterned, it's getting stronger, and it's coming from nowhere. Your director tells you to drop it.",
        choices: [
          { id: "push", label: "Go public with your warning.", check: { attr: "presence", skill: "persuasion", dc: 15 },
            win: { text: "You get a hearing, a small budget and a junior senator's attention. It isn't enough, but when the Fall comes, a few ships are ready because of you.", bio: "Warned the Concord about the Choir's song before the Fall.", skills: { persuasion: 1 }, factions: { fleet: 10 }, ideology: { community: 1 }, hook: "You warned the Concord about the Choir's signal years early, and were almost ignored. Some survivors know this." },
            lose: { text: "You're laughed out of the symposium. When the Fall comes, you remember exactly who laughed, and exactly how few of them are left.", bio: "Warned about the Choir's song, and was ridiculed.", ideology: { self: 2 }, traits: ["survivors_guilt"], hook: "You detected the Choir's signal years early and nobody listened. You still have the data." },
          },
          { id: "drop", label: "Drop it, as you were told.", result: { text: "You archive the data and get your promotion. You remember the date of that decision for the rest of your life.", bio: "Saw the Choir's signal years early, and said nothing.", rank: 1, traits: ["survivors_guilt"], hook: "You saw the Choir's signal years before the Fall, and kept quiet to protect your career. Nobody knows." } },
        ],
      },
    ],
    mishaps: [
      { text: "A sample containment failure in your lab kills your assistant and leaves you with lungs that never quite recover.", bio: "Survived a lab containment failure that killed their assistant.", attrs: { endurance: -1 }, forcedOut: true },
    ],
  },

  medic: {
    name: "Medical Corps",
    blurb: "Field hospitals, plague ships and doing arithmetic with human lives.",
    ranks: ["Orderly", "Medic", "Surgeon", "Chief Surgeon", "Surgeon General"],
    danger: { attr: "willpower", skill: "medicine", dc: 7 },
    advance: { attr: "intellect", skill: "medicine", dc: 12 },
    core: ["medicine", "science", "composure", "persuasion", "leadership"],
    pay: 110,
    kit: ["sidearm", "flak_vest", "medkit", "medkit"],
    signature: "first_do_no_harm",
    perTerm: { factions: { fleet: 2 }, ideology: { mercy: 1 } },
    events: [
      {
        id: "med_triage",
        text: "A mass casualty on a station hub. Forty wounded, enough supplies for twelve. A senator's child is among those you could save. So is a dock worker with three kids. They're both on your table, and you've got one set of hands.",
        choices: [
          { id: "worker", label: "Treat by medical priority, and ignore who they are.", result: { text: "The worker lives. The senator's child doesn't. The senator ends your hospital's funding and your career at that hospital, and you'd do it again.", bio: "Refused to prioritize a senator's child in triage.", skills: { medicine: 1 }, ideology: { community: 2, mercy: 1 }, forcedOut: true, factions: { fleet: 4 }, contact: { role: "Grieving senator", attitude: "hostile", note: "Their child died on your table because you followed triage. They survived the Fall. They sit on the fleet's civil council." } } },
          { id: "senator", label: "Save the senator's child. That favor could save thousands later.", result: { text: "You're right about the favor. A new medical wing gets built in your name. You pay for the worker's kids' schooling without telling anyone.", bio: "Saved a senator's child over a dock worker in triage.", rank: 1, credits: -100, ideology: { reason: 2, self: 1 }, contact: { role: "Grateful senator", attitude: "friendly", note: "Their child lives because of you. They've repaid you well, and they know what it cost." } } },
        ],
      },
      {
        id: "med_plague",
        text: "An outbreak on a transport. Your numbers say that if you quarantine the ship, about nine hundred people die aboard, and everyone else lives. The ship's captain begs you to let them dock.",
        choices: [
          { id: "seal", label: "Seal the quarantine and hold the line.", result: { text: "Nine hundred and twelve. You knew the number before it happened. The outbreak stops.", bio: "Enforced a quarantine that let 912 people die to stop a plague.", skills: { composure: 1, science: 1 }, ideology: { reason: 2, iron: 1 }, traits: ["nightmares"] } },
          { id: "cure", label: "Go aboard and try for a treatment.", check: { attr: "intellect", skill: "medicine", dc: 14 },
            win: { text: "Eleven days in a sealed ward, and a treatment that shouldn't have worked did. Refugees still name children after you.", bio: "Found a plague treatment while sealed aboard a dying transport.", skills: { medicine: 2 }, ideology: { mercy: 2 }, factions: { fleet: 8 }, traits: ["war_hero"] },
            lose: { text: "You're there to the end. You catch it too, and it leaves you with a body that never gets back all its strength.", bio: "Caught a plague while sealed aboard a dying transport.", attrs: { endurance: -1 }, ideology: { mercy: 2 }, traits: ["chronic_illness"] },
          },
        ],
      },
      {
        id: "med_prisoner",
        text: "A wounded Hegemony officer is brought in under guard. Intelligence wants you to keep them conscious through surgery for questioning. They've got information that could save a colony.",
        choices: [
          { id: "refuse", label: "Refuse. A patient is a patient.", result: { text: "You anesthetize them and throw the intelligence officer out of your theater. The Hegemony officer never forgets it, and neither does your commander.", bio: "Refused to let a wounded prisoner be interrogated in surgery.", ideology: { mercy: 3 }, contact: { role: "Hegemony officer", attitude: "friendly", note: "A Hegemony officer whose life and dignity you protected. Now highly placed. Owes you." } } },
          { id: "comply", label: "Do as they ask. A colony's at stake.", result: { text: "The colony is saved. You scrub your hands for a long time afterwards, and you never quite stop.", bio: "Kept a prisoner conscious through surgery for interrogation.", rank: 1, skills: { composure: 1 }, ideology: { iron: 2, order: 1 }, factions: { hegemony: -8 } } },
        ],
      },
    ],
    mishaps: [
      { text: "A field hospital you run takes a direct hit. You dig yourself out with one working arm and spend a month in your own ward.", bio: "Survived the shelling of their own field hospital.", attrs: { agility: -1 }, traits: ["survivors_guilt"], forcedOut: true },
    ],
  },

  adept: {
    name: "Order of Ilun",
    blurb: "Years of silence, stone cells and learning to hear what the universe is humming.",
    requires: { resonance: 4 },
    ranks: ["Novice", "Listener", "Adept", "Elder Adept", "Voice"],
    danger: { attr: "resonance", skill: "attunement", dc: 9 },
    advance: { attr: "willpower", skill: "composure", dc: 12 },
    core: ["attunement", "manifestation", "composure", "lore", "melee"],
    pay: 30,
    kit: ["focus_blade", "adept_robes", "energy_cell"],
    signature: "open_mind",
    perTerm: { factions: { ilun: 5 }, ideology: { faith: 1 } },
    events: [
      {
        id: "adept_silence",
        text: "In the third year of silence, you begin hearing something beneath the hum: a voice, or something trying very hard to be one. The elders say all novices hear it, and that you must never answer.",
        choices: [
          { id: "obey", label: "Hold your silence, as you were taught.", result: { text: "After a year, it stops. The elders nod. You sometimes wonder what it was going to say.", bio: "Held their silence when something spoke beneath the hum.", skills: { composure: 1 }, ideology: { order: 1, faith: 1 } } },
          { id: "answer", label: "Answer it.", check: { attr: "willpower", skill: "composure", dc: 13 },
            win: { text: "It shows you a dead star, wrapped in silver, and a door. Then it's gone. You tell no one, but your dreams have never been quite yours since.", bio: "Answered the voice beneath the hum, and saw the Nest.", skills: { attunement: 1 }, traits: ["prophetic_dreams"], ideology: { faith: 2 }, hook: "As a novice you answered a voice under the Resonance and saw a dead star wrapped in silver, years before anyone knew of the Choir Nest." },
            lose: { text: "They find you three days later, in the snow, unable to say your own name. It comes back. Most of it.", bio: "Answered the voice beneath the hum, and it nearly destroyed them.", attrs: { intellect: -1 }, traits: ["resonance_scarred"], ideology: { faith: 1 } },
          },
        ],
      },
      {
        id: "adept_inquisitor",
        text: "A Hegemony Inquisitor arrives at your monastery with a warrant for a nine-year-old novice, and four armed troopers. The Abbess looks at you, and says nothing.",
        choices: [
          { id: "hide", label: "Smuggle the child out through the old tunnels.", check: { attr: "agility", skill: "stealth", dc: 12 },
            win: { text: "You're three days into the mountains before they notice. The child has grown up since. They write.", bio: "Smuggled a child novice away from a Hegemony Inquisitor.", skills: { stealth: 1, survival: 1 }, ideology: { mercy: 2 }, factions: { hegemony: -10, ilun: 8 }, contact: { role: "Rescued novice", attitude: "ally", note: "A Resonant child you saved from an Inquisitor. Now a young adult, and powerful." } },
            lose: { text: "They catch you at the second gate. You spend a year in a Hegemony dampening cell, and it leaves a mark no one can see.", bio: "Imprisoned by the Hegemony for protecting a novice.", traits: ["wanted", "resonance_scarred"], forcedOut: true, ideology: { freedom: 2 } },
          },
          { id: "fight", label: "Stand in the gate and draw your blade.", check: { attr: "resonance", skill: "manifestation", dc: 13 },
            win: { text: "Four troopers wake up in the courtyard with no memory of the last hour. The Inquisitor leaves alone, and very quietly swears to come back.", bio: "Drove off a Hegemony Inquisitor with the Resonance alone.", skills: { manifestation: 1 }, ideology: { iron: 2 }, factions: { hegemony: -15, ilun: 5 }, contact: { role: "Inquisitor", attitude: "hostile", note: "A Hegemony Inquisitor you humiliated at your monastery. They've been hunting you ever since." } },
            lose: { text: "The Inquisitor's blade drinks everything you throw at it, then opens your shoulder. The child is taken anyway.", bio: "Failed to stop an Inquisitor taking a child novice.", attrs: { might: -1 }, traits: ["survivors_guilt"], ideology: { iron: 1 } },
          },
          { id: "yield", label: "Stand aside. The Order can't survive a war.", result: { text: "The monastery survives. Nobody at dinner meets your eye, and you learn what silence can really do.", bio: "Stood aside when a Hegemony Inquisitor took a child novice.", ideology: { order: 2, reason: 1 }, factions: { ilun: -8 }, traits: ["nightmares"] } },
        ],
      },
      {
        id: "adept_price",
        text: "Your teacher is dying. The Order teaches that you must let go. But you've learned that a Resonant can hold a mind in place, for a while, at a price paid by the one who holds.",
        choices: [
          { id: "hold", label: "Hold on to them, and pay the price.", result: { text: "You give them one more year, and you lose something you can't quite name. They spend that year teaching you everything, and scolding you for it.", bio: "Burned part of themselves to keep their dying teacher alive.", attrs: { resonance: 1, endurance: -1 }, skills: { manifestation: 1 }, ideology: { self: 2 } } },
          { id: "release", label: "Sit with them, and let them go.", result: { text: "It takes three days. You feel the moment the hum takes them back. It's the most peaceful thing you've ever felt, and you hate it.", bio: "Let their teacher die, as the Order teaches.", skills: { composure: 1, attunement: 1 }, ideology: { faith: 2, mercy: 1 } } },
        ],
      },
    ],
    mishaps: [
      { text: "A meditation goes wrong, and you pull too hard on something too large. The stones of your cell crack. The Abbess gently suggests that you leave.", bio: "Left the Order after a dangerous meditation accident.", traits: ["resonance_scarred"], forcedOut: true },
    ],
  },

  envoy: {
    name: "Diplomatic Corps",
    blurb: "Treaty halls, state dinners and ending wars with a very careful choice of words.",
    ranks: ["Attache", "Consular Officer", "Envoy", "Ambassador", "Speaker"],
    danger: { attr: "presence", skill: "persuasion", dc: 7 },
    advance: { attr: "presence", skill: "persuasion", dc: 13 },
    core: ["persuasion", "deception", "lore", "leadership", "commerce"],
    pay: 130,
    kit: ["sidearm", "adept_robes", "medkit"],
    signature: "silver_tongue",
    perTerm: { ideology: { mercy: 1 } },
    events: [
      {
        id: "env_hostages",
        text: "A Syndicate crew is holding a liner, and they'll trade forty hostages for a jailed captain. Your government has a firm no-trade policy, and your orders say to stall until the marines arrive.",
        choices: [
          { id: "stall", label: "Follow orders and stall for the marines.", result: { text: "The marines take the ship. Thirty-one hostages live, and you give a very good speech at the funerals of the other nine.", bio: "Stalled hostage talks until marines stormed a liner, at a cost of nine lives.", skills: { deception: 1 }, ideology: { order: 2 }, rank: 1 } },
          { id: "deal", label: "Cut a real deal, against orders.", check: { attr: "presence", skill: "persuasion", dc: 13 },
            win: { text: "Everyone walks off that ship. You're reprimanded in public and congratulated in private. Mother Quill sends flowers.", bio: "Saved forty hostages with an unauthorized deal.", skills: { persuasion: 1 }, ideology: { freedom: 1, mercy: 2 }, factions: { drift: 10, fleet: 5 } },
            lose: { text: "The deal collapses when a guard panics. The inquiry needs a name, and yours is on the unauthorized transmission.", bio: "Blamed for hostage deaths after an unauthorized deal.", traits: ["disgraced"], forcedOut: true },
          },
        ],
      },
      {
        id: "env_treaty",
        text: "You're negotiating with the Hegemony. Their envoy privately offers you a secret border annex: Tessen colony goes to the Hegemony, and in return they'll guarantee a decade of peace.",
        choices: [
          { id: "sign", label: "Sign it. A million lives for a thousand farmers' freedom.", result: { text: "A decade's peace, as promised. Tessen wakes up one morning under a new flag. They've never learned who signed it.", bio: "Secretly signed away Tessen colony for a decade of peace.", rank: 1, skills: { lore: 1 }, ideology: { order: 1, reason: 2 }, factions: { hegemony: 12 }, hook: "You secretly signed the annex that traded Tessen colony to the Hegemony. Survivors from Tessen would never forgive it." } },
          { id: "leak", label: "Leak it to the press and kill the deal.", check: { attr: "intellect", skill: "deception", dc: 12 },
            win: { text: "The scandal topples a minister, and nobody traces it to you. The border stays open, and so do the old wounds.", bio: "Secretly leaked and destroyed a Hegemony treaty.", skills: { deception: 1 }, ideology: { freedom: 2 }, factions: { hegemony: -10 } },
            lose: { text: "They trace it to your terminal in a day. You're on a shuttle home by dinner, and on a Hegemony watch list by breakfast.", bio: "Dismissed for leaking a secret treaty.", forcedOut: true, traits: ["wanted"] },
          },
        ],
      },
      {
        id: "env_friend",
        text: "Your closest counterpart across the table, {name}, confides over drinks that they're thinking of defecting. It would be a triumph for your career, and a death sentence for them if it's mishandled.",
        choices: [
          { id: "protect", label: "Help them disappear, with no credit to you.", result: { text: "A false name and a quiet colony. A card arrives once a year, unsigned.", bio: "Helped a foreign diplomat disappear quietly.", skills: { streetwise: 1 }, ideology: { community: 1, mercy: 1 }, contact: { role: "Defector", attitude: "ally", note: "A foreign diplomat you helped to disappear. Lives under a false name, and knows Hegemony secrets." } } },
          { id: "use", label: "Turn it into a very public diplomatic triumph.", result: { text: "You make the front page. Their family is arrested the same afternoon. You got them out, you tell yourself, and that's what matters.", bio: "Made their name on a defection that destroyed the defector's family.", rank: 1, credits: 250, ideology: { self: 2 }, factions: { hegemony: -8 }, contact: { role: "Defector", attitude: "hostile", note: "A defector you used for your career. Their family paid for it. They're in the fleet." } } },
        ],
      },
    ],
    mishaps: [
      { text: "A bomb at a state dinner kills your ambassador and leaves you with shrapnel near your spine. You're the only one they can blame who's still alive.", bio: "Survived a bombing at a state dinner, and took the blame.", traits: ["old_wound"], forcedOut: true },
    ],
  },

  agent: {
    name: "Concord Intelligence",
    blurb: "False names, dead drops and a career that officially never happened.",
    ranks: ["Asset", "Field Agent", "Handler", "Station Chief", "Ghost"],
    danger: { attr: "perception", skill: "stealth", dc: 11 },
    advance: { attr: "intellect", skill: "deception", dc: 13 },
    core: ["stealth", "deception", "hacking", "firearms", "awareness"],
    pay: 120,
    kit: ["sidearm", "smugglers_coat", "lockbreaker"],
    signature: "dead_drop",
    perTerm: { ideology: { self: 1 } },
    events: [
      {
        id: "agent_asset",
        text: "Your best asset in the Hegemony, {name}, is about to be exposed. Extracting them would burn the network. Letting them burn protects twelve other people, and they trust you completely.",
        choices: [
          { id: "extract", label: "Pull them out, and burn the network.", result: { text: "They live. Three of the others don't, and Headquarters takes your station away. It's the only thing you've done in this job you're proud of.", bio: "Burned a whole spy network to save one trusted asset.", ideology: { mercy: 2, community: 1 }, forcedOut: true, contact: { role: "Rescued asset", attitude: "ally", note: "A Hegemony insider you extracted at huge cost. Knows the Ministry inside out." } } },
          { id: "burn", label: "Let them burn. That's the job.", result: { text: "You send the signal that everything is fine. You watch the trial on the news feed, and you take the next assignment.", bio: "Let a trusting asset be captured and executed to protect a network.", rank: 1, skills: { composure: 1 }, ideology: { reason: 2, iron: 1 }, traits: ["nightmares"] } },
        ],
      },
      {
        id: "agent_double",
        text: "After years undercover at the Vantor Ministry, you realize that you've started to agree with some of what they say. Your handler has noticed. So has the Ministry.",
        choices: [
          { id: "stay", label: "Stay loyal, and come home.", check: { attr: "willpower", skill: "composure", dc: 12 },
            win: { text: "A long debrief and a quiet commendation. You can never again quite remember which version of you was the real one.", bio: "Survived years undercover in the Vantor Ministry.", skills: { deception: 1, composure: 1 }, ideology: { order: 1 } },
            lose: { text: "You come home, but the debrief breaks something that you'd been holding very carefully. They retire you with a good pension.", bio: "Broke down after years undercover in the Hegemony.", credits: 200, attrs: { willpower: -1 }, forcedOut: true },
          },
          { id: "both", label: "Play both sides, and sell to each.", result: { text: "It's very profitable and very lonely. You know where a lot of bodies are buried, and so does one person in the Ministry.", bio: "Worked as a double agent for the Concord and the Hegemony.", credits: 450, ideology: { self: 2, freedom: 1 }, factions: { hegemony: 10 }, traits: ["secret_identity"], hook: "You were once a double agent. A handler in the Vantor Ministry still has the proof, and may try to use it." } },
        ],
      },
      {
        id: "agent_kill",
        text: "You get an order to kill a Concord senator, for the good of the state. You've got the access and the file. The file doesn't quite add up.",
        choices: [
          { id: "do", label: "Carry it out.", result: { text: "A clean accident, with no questions asked. A week later, you notice who voted differently, and who profited.", bio: "Assassinated a Concord senator on orders they doubted.", skills: { stealth: 1, firearms: 1 }, ideology: { order: 2, iron: 2 }, hook: "You assassinated a Concord senator under orders. Whoever gave that order may still be alive in the fleet." } },
          { id: "investigate", label: "Dig into who really gave that order.", check: { attr: "intellect", skill: "hacking", dc: 14 },
            win: { text: "The order came from someone who had no right to give it. You still have the file, and the name in it is alive and in the fleet.", bio: "Uncovered an illegal assassination order at the top of the Concord.", skills: { hacking: 1 }, ideology: { freedom: 2 }, hook: "You hold proof that a very senior Concord figure, now alive in the fleet, ordered an illegal assassination." },
            lose: { text: "Someone notices you looking. You're blown on your next mission, in a way that can't have been an accident.", bio: "Was betrayed by their own service after asking the wrong question.", attrs: { agility: -1 }, forcedOut: true, ideology: { freedom: 1 } },
          },
        ],
      },
    ],
    mishaps: [
      { text: "Your cover is blown in Kessara. They hold you in a cargo pod for three weeks, and they want names. You don't give any, but you don't come back the same.", bio: "Tortured for three weeks after their cover was blown.", attrs: { might: -1 }, traits: ["paranoid"], forcedOut: true },
    ],
  },

  hegemony: {
    name: "Hegemony Service",
    blurb: "Order, purpose and a pension. You joined believing in it, and you've since left, or you say you have.",
    blockedSpecies: ["synthetic"],
    ranks: ["Cadet", "Adjutant", "Prefect", "Legate", "Inquisitor-Candidate"],
    danger: { attr: "willpower", skill: "composure", dc: 8 },
    advance: { attr: "intellect", skill: "leadership", dc: 13 },
    core: ["leadership", "tactics", "intimidation", "hacking", "firearms"],
    pay: 130,
    kit: ["sidearm", "flak_vest", "forged_papers"],
    signature: "hegemony_doctrine",
    perTerm: { factions: { hegemony: 6, fleet: -3 }, ideology: { order: 1 } },
    events: [
      {
        id: "heg_neighbor",
        text: "Your neighbor of ten years, {name}, has been listening to banned broadcasts. You're required by law to report it. If they're found out and you didn't, your family goes too.",
        choices: [
          { id: "report", label: "File the report.", result: { text: "They're taken at dawn, politely. You get a commendation, and their apartment goes to a nice young couple.", bio: "Denounced their own neighbor to the Ministry.", rank: 1, ideology: { order: 2 }, factions: { hegemony: 5 }, traits: ["nightmares"] } },
          { id: "warn", label: "Warn them, and help them run.", check: { attr: "agility", skill: "stealth", dc: 12 },
            win: { text: "They make it to a Syndicate freighter with a day to spare. You file a report saying how shocked you are.", bio: "Secretly helped a neighbor escape the Ministry.", skills: { deception: 1 }, ideology: { mercy: 2, freedom: 1 }, contact: { role: "Escaped neighbor", attitude: "ally", note: "A neighbor you helped escape the Hegemony. Now living among the Kessara smugglers." } },
            lose: { text: "They're caught at the port, and they don't give you up for four whole days. You run with what you're wearing.", bio: "Fled the Hegemony after helping a neighbor escape.", forcedOut: true, traits: ["wanted"], ideology: { freedom: 2 } },
          },
        ],
      },
      {
        id: "heg_child",
        text: "A Resonant child is found in your district. The law says Inquisition custody. The parents are on their knees in your office, and you've got a stamp in your hand.",
        choices: [
          { id: "stamp", label: "Use the stamp. The law protects everyone.", result: { text: "The office is very quiet afterwards. Your superior says it gets easier. It does, which frightens you more.", bio: "Handed a Resonant child over to the Inquisition.", skills: { intimidation: 1 }, ideology: { order: 2, purity: 1 }, factions: { hegemony: 5, ilun: -10 } } },
          { id: "lose", label: "Lose the paperwork.", check: { attr: "intellect", skill: "hacking", dc: 13 },
            win: { text: "A filing error, a transfer and a family on a transport to the frontier. The system has no idea, and you start to wonder what else it has no idea about.", bio: "Secretly falsified records to save a Resonant child.", skills: { hacking: 1 }, ideology: { mercy: 2, freedom: 2 }, factions: { ilun: 8 } },
            lose: { text: "An auditor notices the gap in eleven days. You run, and you're convicted in your absence.", bio: "Convicted in absence for saving a Resonant child.", forcedOut: true, traits: ["wanted"], ideology: { freedom: 2 } },
          },
        ],
      },
      {
        id: "heg_defect",
        text: "You're offered a Legate's post, with a house on Vantor. Your only duty: to oversee the conscription of a refugee camp, and take the children to the service schools.",
        choices: [
          { id: "accept", label: "Accept. Someone will do it, and you'd do it humanely.", result: { text: "You do, by every standard the Ministry measures. The children call you sir. You've got a very nice house.", bio: "Oversaw the conscription of a refugee camp for the Hegemony.", rank: 1, credits: 300, ideology: { order: 2 }, factions: { hegemony: 8, fleet: -8 }, hook: "You ran a Hegemony conscription camp for refugees. Some of those refugees are in the fleet, and might recognize you." } },
          { id: "defect", label: "Refuse and defect, with whatever files you can carry.", check: { attr: "agility", skill: "stealth", dc: 12 },
            win: { text: "You cross the line with six years of Ministry files, and an offer the Concord can't refuse.", bio: "Defected from the Hegemony with six years of secret files.", skills: { lore: 1 }, ideology: { freedom: 3 }, factions: { hegemony: -20, fleet: 10 }, forcedOut: true, hook: "You defected from the Hegemony with secret files. The Ministry wants you back, alive if convenient." },
            lose: { text: "You make it across, but not with the files, and not without a round through the knee. Nobody on either side trusts you.", bio: "Defected from the Hegemony, wounded and empty-handed.", attrs: { agility: -1 }, ideology: { freedom: 2 }, factions: { hegemony: -20 }, forcedOut: true, traits: ["wanted"] },
          },
        ],
      },
    ],
    mishaps: [
      { text: "A purge reaches your department. You're interrogated for a month and released without explanation, with your career gone and your hands not quite steady.", bio: "Survived a Ministry purge.", traits: ["paranoid"], attrs: { willpower: -1 }, forcedOut: true },
    ],
  },

  raider: {
    name: "Kessara Raiders",
    blurb: "Boarding axes, shared plunder and a captain you're allowed to vote out with a knife.",
    ranks: ["Hand", "Boarder", "Mate", "Captain", "Warlord"],
    danger: { attr: "might", skill: "melee", dc: 11 },
    advance: { attr: "presence", skill: "intimidation", dc: 12 },
    core: ["melee", "gunnery", "intimidation", "piloting", "streetwise"],
    pay: 150,
    kit: ["sidearm", "smugglers_coat", "stim"],
    signature: "boarding_party",
    perTerm: { factions: { drift: 5, fleet: -3 }, ideology: { iron: 1 } },
    events: [
      {
        id: "raid_hospital",
        text: "Your crew takes a prize with a full cargo of medicine. It's a hospital ship, and it's still marked. The crew wants to strip it, and leave the patients to the void.",
        choices: [
          { id: "strip", label: "Strip it. Medicine sells.", result: { text: "Your best haul ever. You buy your own ship with it, and you don't go back to look.", bio: "Stripped a hospital ship and left its patients in the void.", credits: 600, rank: 1, ideology: { iron: 2, self: 2 }, factions: { fleet: -10, drift: 5 }, hook: "You stripped a Concord hospital ship and left the patients to die. Survivors from it may be in the fleet." } },
          { id: "spare", label: "Take half, and leave the patients enough to live.", check: { attr: "presence", skill: "intimidation", dc: 13 },
            win: { text: "One crew member objects, once. A year later, a ship you've never seen breaks off a chase, and flashes its lights in thanks.", bio: "Forced their raiders to spare a hospital ship.", credits: 200, skills: { intimidation: 1 }, ideology: { mercy: 2 } },
            lose: { text: "They put you off the ship at the next rock, with a canteen and a warning. You're lucky, by their standards.", bio: "Marooned by their own crew for sparing a hospital ship.", forcedOut: true, ideology: { mercy: 2 }, skills: { survival: 1 } },
          },
        ],
      },
      {
        id: "raid_vote",
        text: "Your captain has started keeping more than their share, and the crew's looking at you. On Kessara that means a vote, and a vote means knives.",
        choices: [
          { id: "challenge", label: "Call the vote.", check: { attr: "might", skill: "melee", dc: 13 },
            win: { text: "It's over in a minute. You find you like the view from the captain's chair, and you make sure that the crew gets their share.", bio: "Took a raider ship from its captain by the knife.", rank: 2, skills: { melee: 1 }, ideology: { freedom: 1, iron: 1 } },
            lose: { text: "It's over in a minute. You wake up in Kessara's cheapest clinic with a new scar, a limp and no ship.", bio: "Lost a knife vote for command of a raider ship.", attrs: { agility: -1 }, forcedOut: true, contact: { role: "Old captain", attitude: "hostile", note: "A raider captain who beat you in a knife vote and left you for dead." } },
          },
          { id: "warn", label: "Warn the captain, and earn their trust.", result: { text: "Two of the conspirators go out of an airlock. The captain makes you first mate. The crew doesn't look at you at all any more.", bio: "Betrayed a mutiny to their raider captain.", rank: 1, ideology: { self: 2 }, contact: { role: "Raider captain", attitude: "friendly", note: "A raider captain whose life you saved by exposing a mutiny. Still sailing out of Kessara." } } },
        ],
      },
      {
        id: "raid_quill",
        text: "Mother Quill asks you, sweetly, to hit a Concord supply convoy heading for a frontier colony. She's paying double, and she's not really asking.",
        choices: [
          { id: "hit", label: "Hit the convoy.", result: { text: "Clean and profitable. You hear later that Tessen had a very hard winter.", bio: "Raided a Concord aid convoy for Mother Quill.", credits: 400, skills: { gunnery: 1 }, factions: { drift: 12, fleet: -8 }, ideology: { self: 1 } } },
          { id: "double", label: "Warn the convoy, then fake the attack.", check: { attr: "presence", skill: "deception", dc: 13 },
            win: { text: "You put on a wonderful show. The convoy gets through, and Quill pays you, and she never knows. Probably.", bio: "Faked a raid to protect a Concord aid convoy.", credits: 300, skills: { deception: 1 }, ideology: { mercy: 2 } },
            lose: { text: "Quill knows by morning. She's very nice about it. She just needs you to pay back everything you've ever earned.", bio: "Caught betraying Mother Quill.", traits: ["deep_debt"], factions: { drift: -15 }, forcedOut: true },
          },
        ],
      },
    ],
    mishaps: [
      { text: "A boarding goes wrong when the merchant crew fight back with a plasma cutter. You survive it, and your crew doesn't wait around for you.", bio: "Left for dead by their own raider crew.", attrs: { presence: -1 }, traits: ["old_wound"], forcedOut: true },
    ],
  },

  colonist: {
    name: "Frontier Settler",
    blurb: "Breaking new ground on a world that didn't ask for you. No one's coming to help.",
    ranks: ["Hand", "Settler", "Foreman", "Elder", "Founder"],
    danger: { attr: "endurance", skill: "survival", dc: 5 },
    advance: { attr: "presence", skill: "leadership", dc: 11 },
    core: ["survival", "athletics", "engineering", "medicine", "firearms"],
    pay: 40,
    kit: ["sidearm", "flak_vest", "medkit"],
    signature: "homesteader",
    perTerm: { ideology: { community: 1 } },
    events: [
      {
        id: "col_blight",
        text: "A blight takes the winter crop, and there's food for two hundred in a settlement of three hundred. The elders are arguing over who should get a share. They've asked you to decide.",
        choices: [
          { id: "lots", label: "Draw lots, with your own name in the drum.", result: { text: "It's the worst winter of your life, and nobody can say it wasn't fair. People look to you afterward.", bio: "Led a starving colony through a fair and terrible winter.", skills: { leadership: 1, survival: 1 }, ideology: { community: 2 } } },
          { id: "useful", label: "Feed those who can work. The rest will have to take their chances.", result: { text: "The colony survives, and it's stronger for it, as everyone keeps saying. The graves are all very small, and you dug most of them.", bio: "Rationed a colony's food by usefulness through a killing winter.", skills: { survival: 1 }, ideology: { iron: 2, reason: 1 }, traits: ["nightmares"] } },
          { id: "steal", label: "Ride out and raid the next valley's stores.", check: { attr: "agility", skill: "stealth", dc: 12 },
            win: { text: "Everyone in your settlement lives. Nobody asks where the grain came from, and you never go to that valley again.", bio: "Secretly raided a neighboring settlement to feed their own.", skills: { stealth: 1 }, ideology: { self: 2 } },
            lose: { text: "They've posted guards. You come home with a bullet in your shoulder and no grain, and it's a very hard winter.", bio: "Shot during a failed raid on a neighboring settlement.", attrs: { might: -1 }, ideology: { self: 1 } },
          },
        ],
      },
      {
        id: "col_raiders",
        text: "Kessara raiders land and ask for a tenth of the harvest, as a 'protection tithe'. They've got a gunship, and you've got farm tools and sixty frightened people.",
        choices: [
          { id: "pay", label: "Pay it. People matter more than pride.", result: { text: "They come back every year, like the seasons. But nobody dies, and in time the raiders' mate even starts to ask after your family.", bio: "Paid raiders' tithes to keep a colony alive.", skills: { commerce: 1 }, credits: -50, ideology: { mercy: 1 }, factions: { drift: 5 } } },
          { id: "fight", label: "Organize a defense and an ambush.", check: { attr: "intellect", skill: "tactics", dc: 12 },
            win: { text: "A landslide you've been preparing for a month takes the gunship off the landing field. Nobody ever asks your valley for a tithe again.", bio: "Organized a colony's defense and destroyed a raider gunship.", skills: { tactics: 1, firearms: 1 }, rank: 1, ideology: { iron: 2 }, factions: { drift: -10 } },
            lose: { text: "It goes badly. They burn half the settlement as a lesson, then take the tithe anyway. Some people never forgive you for trying.", bio: "Led a failed stand against raiders that burned their settlement.", traits: ["survivors_guilt"], ideology: { iron: 1 } },
          },
        ],
      },
      {
        id: "col_signal",
        text: "Your well-diggers break into a smooth, buried chamber. It's warm, it hums, and a child who wandered in came out speaking a language no one knows.",
        choices: [
          { id: "seal", label: "Seal it, and never speak of it.", result: { text: "You pour the concrete yourself. The child forgets the words, over time. Most of them.", bio: "Sealed a First Builder chamber under their colony.", skills: { composure: 1 }, ideology: { purity: 1 }, hook: "A First Builder chamber lies sealed under your old colony. You know exactly where it is." } },
          { id: "explore", label: "Go down there yourself.", check: { attr: "resonance", skill: "attunement", dc: 12 },
            win: { text: "You stay down there for an hour, and it feels like a minute. You come back knowing that you've been listened to.", bio: "Explored a First Builder chamber and felt it listening.", skills: { attunement: 1, lore: 1 }, ideology: { faith: 2 }, traits: ["prophetic_dreams"] },
            lose: { text: "You come out three days later with white hair and no memory of going in. You still wake up at night, with your hands drawing the same shape.", bio: "Lost three days in a First Builder chamber.", attrs: { perception: -1 }, ideology: { faith: 1 }, traits: ["hears_the_song"] },
          },
        ],
      },
    ],
    mishaps: [
      { text: "A dust storm catches you four days from anywhere with a broken rover. They find you on day nine. You lose two toes and your faith in the weather reports.", bio: "Survived nine days stranded in a dust storm.", attrs: { agility: -1 }, skills: { survival: 1 }, forcedOut: true },
    ],
  },
};

// Things that can happen in any career.
export const GENERAL_EVENTS = [
  {
    id: "gen_love",
    text: "You fall hard for {name}, a posting away from you and not on any career path you can plan around. They've asked you to stay.",
    choices: [
      { id: "stay", label: "Give up the next promotion, and stay.", result: { text: "You have three of the best years of your life. It doesn't save you from anything that comes next, but you'll always have had them.", bio: "Gave up advancement for love.", skills: { persuasion: 1 }, ideology: { community: 1 }, contact: { role: "Former partner", attitude: "friendly", note: "The love of your life, once. You don't know what to say to them now." } } },
      { id: "go", label: "Take the promotion. You'll write.", result: { text: "You do write, for a while. You get very good at your job, and there's always a lot of it.", bio: "Chose their career over someone they loved.", rank: 1, ideology: { self: 1 }, contact: { role: "Former partner", attitude: "wary", note: "You left them for a promotion. They survived the Fall, and they're somewhere in the fleet." } } },
    ],
  },
  {
    id: "gen_vice",
    text: "The hours are brutal and combat stims are easy to get. Everyone on your shift takes them. You've started to take one on your days off.",
    choices: [
      { id: "use", label: "It's under control. You're getting so much done.", result: { text: "You're right. For about two years, you're the best you've ever been. Then you're not.", bio: "Developed a stim habit that they still fight.", skills: { awareness: 1 }, traits: ["stim_addict"] } },
      { id: "quit", label: "Quit cold, and take the time it costs.", check: { attr: "willpower", skill: "composure", dc: 11 },
        win: { text: "Six very bad weeks. You come out of them knowing exactly how strong you are.", bio: "Kicked a stim habit through sheer will.", attrs: { willpower: 1 } },
        lose: { text: "You quit four times. The fifth one sticks, mostly, but it costs you friends and most of your savings.", bio: "Spent years fighting a stim addiction.", credits: -150, traits: ["stim_addict"] },
      },
    ],
  },
  {
    id: "gen_windfall",
    text: "A distant relative dies and leaves you a stake in a shipping firm. The firm's lawyer, {name}, suggests quietly that some of the books would be better left unread.",
    choices: [
      { id: "cash", label: "Sell your share quickly, and don't ask.", result: { text: "It's a very nice sum. You find out years later what the firm was shipping, but by then the money's long gone.", bio: "Inherited and sold a stake in a shady shipping firm.", credits: 450, ideology: { self: 1 } } },
      { id: "audit", label: "Read the books.", check: { attr: "intellect", skill: "commerce", dc: 12 },
        win: { text: "The firm was running guns to the Syndicate. You take it to the authorities, and you keep a nice finder's fee.", bio: "Exposed a family firm's gun-running.", credits: 200, skills: { commerce: 1 }, ideology: { order: 1 }, factions: { drift: -8 } },
        lose: { text: "You understand just enough to be dangerous, and not enough to be safe. The firm's other owners make you an offer that you should have taken.", bio: "Asked the wrong questions about a family firm.", credits: -100, contact: { role: "Crooked lawyer", attitude: "hostile", note: "A lawyer for a crooked shipping firm you once tried to audit." } },
      },
    ],
  },
  {
    id: "gen_rival",
    text: "A colleague, {name}, has been taking credit for your work for years, and they've just been promoted over you. You've got something on them that could end them.",
    choices: [
      { id: "ruin", label: "Use it. They had it coming.", result: { text: "They're gone by the end of the week. You feel wonderful for about a day.", bio: "Destroyed a rival's career with a secret.", rank: 1, skills: { deception: 1 }, ideology: { self: 1, iron: 1 }, contact: { role: "Ruined rival", attitude: "hostile", note: "A rival whose career you destroyed. Survived the Fall, and hasn't forgiven you." } } },
      { id: "outdo", label: "Let your work speak for itself.", check: { attr: "intellect", skill: "awareness", dc: 12 },
        win: { text: "It takes two more years, but people eventually notice who's doing what. Your rival shakes your hand, and even seems to mean it.", bio: "Beat a rival honestly, in the end.", rank: 1, ideology: { order: 1 }, contact: { role: "Old rival", attitude: "neutral", note: "A rival you beat fair and square, who has grudging respect for you." } },
        lose: { text: "It doesn't. They rise, and you don't. But you sleep at night, which is more than most people can say.", bio: "Refused to destroy a rival, and paid for it.", skills: { composure: 1 }, ideology: { mercy: 1 } },
      },
    ],
  },
  {
    id: "gen_mentor",
    text: "An old hand, {name}, takes you under their wing, teaching you all the things they don't put in the manuals. Some of those things are not, strictly, legal.",
    choices: [
      { id: "learn", label: "Soak up everything they can teach you.", result: { text: "You've never learned so much so quickly. A decade later, you still catch yourself using their exact phrases.", bio: "Studied under a brilliant, shady mentor.", skills: { streetwise: 1, awareness: 1 }, ideology: { freedom: 1 }, contact: { role: "Old mentor", attitude: "friendly", note: "An old hand who taught you everything that isn't in the manuals. Still has connections everywhere." } } },
      { id: "report", label: "Learn the legal parts, and keep your distance.", result: { text: "You come away with a solid grounding and a clean record. Your old mentor always seems faintly disappointed.", bio: "Kept a careful distance from a shady mentor.", skills: { lore: 1 }, ideology: { order: 1 } } },
    ],
  },
  {
    id: "gen_family",
    text: "News arrives that your parent is dying, far away. It would mean leave without pay, right as your unit's being deployed. Your family's been asking for you.",
    choices: [
      { id: "go", label: "Go home.", result: { text: "You get there in time. You hear some things you needed to hear, and you lose a year of seniority.", bio: "Left their post to be with a dying parent.", attrs: { willpower: 1 }, credits: -100, ideology: { community: 1 } } },
      { id: "stay", label: "Stay at your post. They'd understand.", result: { text: "The deployment goes well. You get a message telling you it's over, and you read it between shifts.", bio: "Stayed at their post while a parent died.", rank: 1, ideology: { order: 1, self: 1 }, traits: ["survivors_guilt"] } },
    ],
  },
  {
    id: "gen_relic",
    text: "In a dockside curio shop, you handle a chip of warm crystal that nobody can explain. The shopkeeper, {name}, goes pale when you touch it, and says that it's yours for free if you'll leave and never return.",
    choices: [
      { id: "take", label: "Take it, and keep it close.", result: { text: "It's on a cord around your neck to this day. It's never been cold. Sometimes, it points somewhere.", bio: "Found a strange warm crystal that they still carry.", skills: { lore: 1 }, ideology: { faith: 1 }, hook: "You carry a warm crystal shard, found years ago in a curio shop. It reacts to the Beacon signal." } },
      { id: "leave", label: "Put it back and walk away.", result: { text: "You walk out with your skin crawling. You read in a bulletin a week later that the shop burned down.", bio: "Refused a strange crystal in a curio shop that later burned down.", skills: { awareness: 1 }, ideology: { reason: 1 } } },
    ],
  },
  {
    id: "gen_fire",
    text: "A shipboard fire traps six crew behind a bulkhead. You could reach them, but the fire suppression system will vent the whole section in ninety seconds.",
    choices: [
      { id: "rescue", label: "Go in after them.", check: { attr: "endurance", skill: "athletics", dc: 12 },
        win: { text: "You get all six, with four seconds left. The burn scars on your arms are something people notice at parties.", bio: "Saved six crew from a shipboard fire.", skills: { athletics: 1 }, ideology: { mercy: 1 }, factions: { fleet: 4 } },
        lose: { text: "You get two out. The vent takes the rest, and takes a fair amount of your lungs along with it.", bio: "Tried to save six crew from a fire and saved two.", attrs: { endurance: -1 }, traits: ["survivors_guilt"] },
      },
      { id: "seal", label: "Seal the section and save the ship.", result: { text: "The ship survives. The inquiry clears you completely, and it was absolutely the right call. Everyone says so.", bio: "Sealed six crew in a burning section to save the ship.", skills: { composure: 1 }, ideology: { reason: 1, iron: 1 }, traits: ["nightmares"] } },
    ],
  },
];

// For when a survival roll fails in any career.
export const GENERAL_MISHAPS = [
  { text: "A transit shuttle loses pressure on approach. You spend a very long time in a medical pod, and your position has been filled by the time you get out.", bio: "Badly hurt in a shuttle accident.", attrs: { might: -1 }, forcedOut: true },
  { text: "A false accusation of theft follows you through a long inquiry. You're cleared in the end, but nobody wants you around any more.", bio: "Forced out by a false accusation.", credits: -100, forcedOut: true, ideology: { freedom: 1 } },
  { text: "A long illness takes the better part of a year. When you're well enough to come back, there's nothing to come back to.", bio: "Lost a year to serious illness.", attrs: { endurance: -1 }, forcedOut: true },
];

// Every life ends here: where you were when the Concord fell, six months ago.
export const FALL_CHOICES = {
  last_stand: {
    label: "You fought in the last battle",
    desc: "You were at the Graveyard when the Concord's last fleet died. You kept fighting until there was nothing left to fight with, and the Meridian was still flying.",
    result: { text: "You saw the Choir close up, and you saw them wearing the faces of people you'd served with. The Meridian's senior officers all died at their posts, leaving you in the chair.", bio: "Fought in the last battle at the Graveyard, and took command of the Meridian when everyone above them died.", other: { text: "You saw the Choir close up, and you saw them wearing the faces of people you'd served with. You got out on the last thing flying, and you've been trying to find a reason for that ever since.", bio: "Fought in the last battle at the Graveyard, and got out on the last thing flying." }, skills: { tactics: 1 }, ideology: { iron: 2 }, factions: { fleet: 5 }, traits: ["battle_hardened"] },
  },
  evacuated: {
    label: "You ran the evacuation",
    desc: "When Aurelis started to burn, you stayed at the docks getting people onto anything that could fly, for as long as there was anything left.",
    result: { text: "You got eleven thousand people off Aurelis. You know the number by heart, and you also know how many were still on the docks when the last ship lifted. When the captain of the Meridian died, the survivors asked for you by name.", bio: "Ran the evacuation of Aurelis, and was chosen as captain of the Meridian by the survivors.", other: { text: "You got eleven thousand people off Aurelis. You know the number by heart, and you also know how many were still on the docks when the last ship lifted. Nobody remembers who ran the docks, and you've stopped telling them.", bio: "Ran the evacuation of Aurelis, and got out on the last ship." }, skills: { leadership: 1 }, ideology: { community: 2, mercy: 1 }, factions: { fleet: 10 } },
  },
  fled: {
    label: "You took a ship and ran",
    desc: "You didn't stay. You grabbed a working ship and got out, and you only turned back for the fleet when there was nowhere else to go.",
    result: { text: "You got out early. A lot of people who didn't are dead, and you're alive, and you've been told it's not your fault. The fleet needed someone who could fly, and it didn't ask too many questions.", bio: "Fled the Fall in a stolen ship, then joined the fleet, and was put in command of the Meridian out of desperation.", other: { text: "You got out early. A lot of people who didn't are dead, and you're alive, and you've been told it's not your fault. The ship's long gone now, and you've been making your own way ever since.", bio: "Fled the Fall in a stolen ship, and has been making their own way ever since." }, skills: { piloting: 1, survival: 1 }, ideology: { self: 2 }, factions: { fleet: -5 }, traits: ["survivors_guilt"], hook: "You ran during the Fall while others stayed. A few people in the fleet know exactly what you did." },
  },
  captured: {
    label: "You were taken by the Choir",
    desc: "A silver ship took you off a dying station. You don't remember most of what happened next. You escaped, or they let you go.",
    result: { text: "Forty days are missing from your life. You woke up in a lifepod with no injuries, and something you can't stop hearing. Commander Voss gave you the Meridian because there was nobody else, and she watches you very carefully.", bio: "Spent forty missing days as a prisoner of the Choir, then was made captain of the Meridian when nobody else was left.", other: { text: "Forty days are missing from your life. You woke up in a lifepod with no injuries, and something you can't stop hearing. Whoever picked you up asked no questions, and you've kept moving ever since.", bio: "Spent forty missing days as a prisoner of the Choir, and came out with no injuries and no answers." }, skills: { composure: 1 }, ideology: { ascension: 1 }, factions: { fleet: -5 }, traits: ["hears_the_song"], hook: "You were held by the Choir for forty days and you can't remember it. Nobody knows why you were released, including you." },
  },
  away: {
    label: "You were far away when it happened",
    desc: "You were out beyond the frontier on business of your own. By the time you heard, there was nothing left to go home to, so you went looking for what was left.",
    result: { text: "You learned of the end of your civilization from a week-old news bulletin in a frontier bar. You found the fleet by following the distress calls. It took you three months, and when you got there they needed anyone who knew how to give an order.", bio: "Was beyond the frontier during the Fall, found the fleet months later, and was given the Meridian by necessity.", other: { text: "You learned of the end of your civilization from a week-old news bulletin in a frontier bar. By the time you'd taken it in, there was nothing to go home to, so you stopped where you were and found work.", bio: "Was beyond the frontier during the Fall, and has been finding work where they can ever since." }, skills: { navigation: 1, lore: 1 }, ideology: { reason: 1 }, hook: "You weren't there during the Fall. Some refugees resent you for being spared." },
  },
};
