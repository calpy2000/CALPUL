// One-time repair script: regenerates answers.js correctly from the known
// historical (pre-bug) 366-title list, filtered by the same removal set
// remove-days.js was given — bypassing remove-days.js's buggy answers.js
// parser (which introduced an off-by-one shift). The images/ folder itself
// was already correctly compacted to 262 files (1.jpg..262.jpg) by that
// same run, since the file-renaming logic didn't share the parsing bug —
// only the paired titles were wrong. This script just re-pairs the correct
// titles with the already-correctly-ordered images.

const fs = require('fs');
const path = require('path');

const ANSWERS_PATH = path.join(__dirname, '..', '..', 'games', 'muveez', 'answers.js');

const HISTORICAL_366 = [
  'The Wizard of Oz','Gone with the Wind','Citizen Kane','Some Like It Hot','Rear Window',
  '12 Angry Men','Ben-Hur','The Sound of Music','Mary Poppins','My Fair Lady',
  'West Side Story','To Kill a Mockingbird',"Breakfast at Tiffany's",'Dr. No','Goldfinger',
  'The Graduate','2001: A Space Odyssey','Planet of the Apes','Butch Cassidy and the Sundance Kid','Willy Wonka & the Chocolate Factory',
  'The Godfather','Jaws','Star Wars','Rocky','Grease',
  'Apocalypse Now','Taxi Driver','Annie Hall',"One Flew Over the Cuckoo's Nest",'Close Encounters of the Third Kind',
  'Superman','Saturday Night Fever','The Exorcist','A Clockwork Orange','The Sting',
  'Young Frankenstein','Monty Python and the Holy Grail','E.T. the Extra-Terrestrial','Back to the Future','Ghostbusters',
  'Return of the Jedi','Indiana Jones and the Last Crusade','Top Gun','The Karate Kid','The Goonies',
  'Beetlejuice','Batman','Die Hard','Predator','The Terminator',
  'Gremlins','Big','Dirty Dancing',"Ferris Bueller's Day Off",'The Breakfast Club',
  'Full Metal Jacket','Platoon','Field of Dreams','Coming to America','Back to the Future Part II',
  'Poltergeist','The NeverEnding Story','Labyrinth','Footloose','Flashdance',
  'Scarface','Tootsie','Amadeus','Stand by Me','The Shining',
  'Tron','WarGames','Beverly Hills Cop','Crocodile Dundee','Working Girl',
  'When Harry Met Sally...','Lethal Weapon','Jurassic Park','Titanic','The Lion King',
  'Forrest Gump','The Matrix','Toy Story','Home Alone','Pulp Fiction',
  'The Shawshank Redemption','Aladdin','Beauty and the Beast','Independence Day','Men in Black',
  'Mrs. Doubtfire','Jumanji','Speed','Braveheart','Good Will Hunting',
  'Saving Private Ryan','Mission: Impossible','Face/Off','The Rock','Se7en',
  'American Beauty','Notting Hill','Groundhog Day','A Few Good Men','The Fugitive',
  'Dances with Wolves','Edward Scissorhands','Batman Returns','The Nightmare Before Christmas','Goodfellas',
  'The Silence of the Lambs','Terminator 2: Judgment Day','Basic Instinct','True Lies',"You've Got Mail",
  'The Big Lebowski','Toy Story 2',"A Bug's Life",'Hercules','Mulan',
  'Tarzan','Pocahontas','James and the Giant Peach','Babe','Free Willy',
  'The Lost World: Jurassic Park','Get Shorty','Clueless',"There's Something About Mary",'Austin Powers: International Man of Mystery',
  "Wayne's World",'Dumb and Dumber','Ace Ventura: Pet Detective','The Mask','Gladiator',
  'The Lord of the Rings: The Fellowship of the Ring','The Lord of the Rings: The Two Towers','The Lord of the Rings: The Return of the King',"Harry Potter and the Sorcerer's Stone",'Harry Potter and the Chamber of Secrets',
  'Harry Potter and the Goblet of Fire','Shrek','Spider-Man 2','Pirates of the Caribbean: The Curse of the Black Pearl','Monsters, Inc.',
  'The Incredibles','Ratatouille','WALL-E','Up','Avatar',
  'Slumdog Millionaire','The Departed','No Country for Old Men','There Will Be Blood','Little Miss Sunshine',
  'Juno','Superbad','Anchorman: The Legend of Ron Burgundy','Napoleon Dynamite','Mean Girls',
  'Elf','The Notebook','500 Days of Summer','Wedding Crashers','Talladega Nights: The Ballad of Ricky Bobby',
  'Zoolander',"Ocean's Eleven",'Minority Report','I Am Legend','War of the Worlds',
  'King Kong','Cast Away','A Beautiful Mind','Chicago','Moulin Rouge!',
  'Kill Bill: Volume 1','School of Rock','Bruce Almighty','The 40-Year-Old Virgin','Knocked Up',
  'Meet the Parents','Legally Blonde','Bend It Like Beckham','The Devil Wears Prada','National Treasure',
  'The Bourne Identity',"Ocean's Twelve",'Charlie and the Chocolate Factory','Madagascar','Ice Age',
  'Shark Tale','Cars','Happy Feet','Enchanted','Night at the Museum',
  'Freaky Friday','The Princess Diaries','Spy Kids','Inception','The Avengers',
  'Frozen','Guardians of the Galaxy','Interstellar','Mad Max: Fury Road','The Social Network',
  'La La Land','Get Out','Black Panther','Wonder Woman','Deadpool',
  'Zootopia','Moana','Coco','Inside Out','The Martian',
  'Gravity','Whiplash','The Grand Budapest Hotel','Django Unchained','Skyfall',
  'Gone Girl','The Wolf of Wall Street','Baby Driver','Knives Out','Parasite',
  '1917','Jojo Rabbit','A Quiet Place','It','Star Wars: The Force Awakens',
  'Rogue One: A Star Wars Story','Doctor Strange','Ant-Man','Captain America: Civil War','Toy Story 3',
  'Toy Story 4','Despicable Me','Despicable Me 2','Minions','The Secret Life of Pets',
  'Kung Fu Panda','How to Train Your Dragon','Brave','The Hunger Games','Divergent',
  'Twilight','The Fault in Our Stars','Now You See Me','Argo','Silver Linings Playbook',
  'Bridesmaids','The Hangover','21 Jump Street','Pitch Perfect','Crazy Rich Asians',
  'A Star Is Born','Bohemian Rhapsody','Green Book','Three Billboards Outside Ebbing, Missouri','Lady Bird',
  'Call Me by Your Name','Blade Runner 2049','Dunkirk','Logan','Thor: Ragnarok',
  'Spider-Man: Homecoming','Jurassic World','Star Trek','Iron Man 2','Iron Man 3',
  'Avengers: Age of Ultron','Big Hero 6','Wreck-It Ralph','Tangled','Maleficent',
  'Cinderella','The Jungle Book','Beauty and the Beast','Aladdin','The Lion King',
  'Dune','Everything Everywhere All at Once','Top Gun: Maverick','Barbie','Oppenheimer',
  'Spider-Man: No Way Home','No Time to Die','The Batman','Encanto','Turning Red',
  'Nope','Elvis','Puss in Boots: The Last Wish','Guardians of the Galaxy Vol. 3','John Wick: Chapter 4',
  'Mission: Impossible – Dead Reckoning Part One','Avatar: The Way of Water','Free Guy','Soul','Onward',
  'Luca','Lightyear','Elemental','The Super Mario Bros. Movie','Wonka',
  'Poor Things','Killers of the Flower Moon','Napoleon','Wicked','Inside Out 2',
  'Deadpool & Wolverine','Dune: Part Two','Snow White and the Seven Dwarfs','Pinocchio','Fantasia',
  'Dumbo','Bambi','Cinderella','Peter Pan','Lady and the Tramp',
  '101 Dalmatians','The Jungle Book','Robin Hood','The Fox and the Hound','The Little Mermaid',
  "Charlotte's Web",'Matilda','Little Women','The Prince of Egypt','Shaun the Sheep Movie',
  'Paddington','Coraline','Corpse Bride','Casino Royale','GoldenEye',
  'Live and Let Die','The Spy Who Loved Me','Moonraker','Mission: Impossible II','Mission: Impossible – Ghost Protocol',
  'The Fast and the Furious','Fast Five','Furious 7','Rocky II','Rocky III',
  'Rocky IV','Creed','Cool Runnings','Remember the Titans','The Blind Side',
  'Moneyball','Rudy','A League of Their Own','Space Jam','Happy Gilmore',
  'Click','50 First Dates','The Wedding Singer','Godzilla','King Kong',
  'The Mummy',"National Lampoon's Vacation",'Home Alone 2: Lost in New York','The Santa Clause',"It's a Wonderful Life",
  'A Christmas Story',
];

if (HISTORICAL_366.length !== 366) {
  console.error('Sanity check failed: expected 366 historical titles, got', HISTORICAL_366.length);
  process.exit(1);
}

const removeSet = new Set([19,20,29,30,37,38,42,52,60,71,98,109,112,126,130,136,137,138,139,140,141,144,149,151,157,158,159,161,164,165,172,173,176,178,187,188,203,204,207,220,226,229,230,231,234,235,236,238,240,247,249,250,253,259,260,261,262,263,265,266,269,270,271,274,275,276,281,282,283,286,288,293,294,295,296,297,298,300,304,310,311,312,313,314,329,330,333,339,340,341,342,343,344,345,346,347,350,351,352,353,356,363,365,366]);

const survivors = [];
for (let day = 1; day <= 366; day++) {
  if (!removeSet.has(day)) survivors.push(HISTORICAL_366[day - 1]);
}

console.log('Survivors:', survivors.length, '(expect 262, matching the images/ folder)');

const lines = survivors.map((title, i) => {
  const day = i + 1;
  const escaped = title.replace(/'/g, "\\'");
  return `  '${escaped}', // day ${day}: ${title}`;
});

const fileContent = `// Auto-generated by tools/muveez-curation/fix-answers.js — do not hand-edit.
// One answer per calendar day-of-year, same indexing as images/<day>.jpg
// (see index.js's dayOfYear() usage).
export const ANSWERS_366 = [
${lines.join('\n')}
];
`;
fs.writeFileSync(ANSWERS_PATH, fileContent);
console.log('answers.js corrected and rewritten.');
