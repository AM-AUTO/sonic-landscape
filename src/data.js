/**
 * Sonic Landscape – Location Dataset
 *
 * Each entry represents an acoustic environment or landmark.
 * Fields:
 *   id          {string}  Unique identifier
 *   name        {string}  Display name
 *   category    {string}  One of: forest | ocean | urban | desert | mountain | wetland
 *   emoji       {string}  Icon for map marker
 *   lat         {number}  Latitude (WGS-84)
 *   lng         {number}  Longitude (WGS-84)
 *   country     {string}  Country name
 *   region      {string}  Region / state / province
 *   description {string}  Short description of the soundscape
 *   decibels    {number}  Typical ambient sound level in dB
 *   peakSeason  {string}  Best time to visit for peak acoustic experience
 *   recorded    {boolean} Whether a high-quality recording exists
 */

// eslint-disable-next-line no-unused-vars
const SONIC_LOCATIONS = [
  {
    id: "amazon-dawn-chorus",
    name: "Amazon Dawn Chorus",
    category: "forest",
    emoji: "🌿",
    lat: -3.4653,
    lng: -62.2159,
    country: "Brazil",
    region: "Amazonas",
    description:
      "The world's most biodiverse soundscape erupts each morning as thousands of bird and insect species simultaneously announce the sunrise over the rainforest canopy.",
    decibels: 68,
    peakSeason: "June – August",
    recorded: true,
  },
  {
    id: "monterey-bay-whales",
    name: "Monterey Bay – Whale Song",
    category: "ocean",
    emoji: "🐋",
    lat: 36.8007,
    lng: -121.9473,
    country: "USA",
    region: "California",
    description:
      "Hydrophones beneath the bay capture the haunting low-frequency calls of blue and humpback whales migrating along the Pacific coast.",
    decibels: 55,
    peakSeason: "April – November",
    recorded: true,
  },
  {
    id: "shibuya-crossing",
    name: "Shibuya Scramble Crossing",
    category: "urban",
    emoji: "🏙️",
    lat: 35.6595,
    lng: 139.7004,
    country: "Japan",
    region: "Tokyo",
    description:
      "Every two minutes, the world's busiest pedestrian crossing floods with 3,000 people, creating a rhythmic surge of footsteps, conversations, and urban ambience.",
    decibels: 82,
    peakSeason: "Year-round",
    recorded: true,
  },
  {
    id: "sahara-silence",
    name: "Sahara Grand Erg – Near Silence",
    category: "desert",
    emoji: "🏜️",
    lat: 26.5,
    lng: 9.5,
    country: "Algeria",
    region: "Tamanrasset",
    description:
      "Deep in the sand sea, wind erases itself; recordings here have captured natural ambient levels below 20 dB – among the quietest places on Earth.",
    decibels: 22,
    peakSeason: "October – March",
    recorded: false,
  },
  {
    id: "yellowstone-geysers",
    name: "Yellowstone – Old Faithful Area",
    category: "mountain",
    emoji: "♨️",
    lat: 44.4605,
    lng: -110.8281,
    country: "USA",
    region: "Wyoming",
    description:
      "Rumbling underground plumbing, periodic geyser eruptions, and bison herds create a primordial soundscape unchanged for millennia.",
    decibels: 58,
    peakSeason: "May – September",
    recorded: true,
  },
  {
    id: "okavango-frogs",
    name: "Okavango Delta – Frog Chorus",
    category: "wetland",
    emoji: "🐸",
    lat: -19.2833,
    lng: 22.9,
    country: "Botswana",
    region: "North-West District",
    description:
      "After the first rains flood the delta, thousands of reed frogs fill the papyrus beds with overlapping calls—a dense, layered acoustic texture unlike any other.",
    decibels: 74,
    peakSeason: "November – January",
    recorded: true,
  },
  {
    id: "great-barrier-reef",
    name: "Great Barrier Reef – Coral Soundscape",
    category: "ocean",
    emoji: "🐠",
    lat: -18.2871,
    lng: 147.6992,
    country: "Australia",
    region: "Queensland",
    description:
      "Healthy coral reefs snap, crackle, and hum with the sound of thousands of snapping shrimps and reef fish—a biological indicator of ecosystem health.",
    decibels: 62,
    peakSeason: "June – October",
    recorded: true,
  },
  {
    id: "black-forest-winter",
    name: "Black Forest in Winter",
    category: "forest",
    emoji: "🌲",
    lat: 47.9,
    lng: 8.15,
    country: "Germany",
    region: "Baden-Württemberg",
    description:
      "Heavy snowfall on pine boughs creates near-perfect sound absorption, leaving only wind whispers and the occasional crack of a frost-split branch.",
    decibels: 28,
    peakSeason: "December – February",
    recorded: true,
  },
  {
    id: "new-york-subway",
    name: "New York City Subway",
    category: "urban",
    emoji: "🚇",
    lat: 40.7128,
    lng: -74.006,
    country: "USA",
    region: "New York",
    description:
      "Steel wheels on steel rails, platform announcements, buskers, and conversations in dozens of languages form the iconic sonic signature of the city.",
    decibels: 95,
    peakSeason: "Year-round",
    recorded: true,
  },
  {
    id: "atacama-silence",
    name: "Atacama Desert – Valle de la Luna",
    category: "desert",
    emoji: "🌙",
    lat: -22.9167,
    lng: -68.25,
    country: "Chile",
    region: "Antofagasta",
    description:
      "One of the driest places on Earth hosts almost no biological sound; wind sculpts dunes into natural instruments that produce infrasound on still nights.",
    decibels: 18,
    peakSeason: "May – October",
    recorded: false,
  },
  {
    id: "himalayas-wind",
    name: "Himalayan High Passes",
    category: "mountain",
    emoji: "🏔️",
    lat: 28.0,
    lng: 84.0,
    country: "Nepal",
    region: "Gandaki Province",
    description:
      "At altitude, thin air carries prayer flags flapping in wind and the distant rumble of avalanches across a vast, sparsely populated acoustic landscape.",
    decibels: 45,
    peakSeason: "March – May",
    recorded: true,
  },
  {
    id: "louisiana-bayou",
    name: "Louisiana Bayou at Dusk",
    category: "wetland",
    emoji: "🌅",
    lat: 29.95,
    lng: -90.07,
    country: "USA",
    region: "Louisiana",
    description:
      "Alligators, bullfrogs, cicadas, and swamp birds layer into a rich twilight chorus as humidity amplifies every rustle and splash.",
    decibels: 71,
    peakSeason: "April – July",
    recorded: true,
  },
];
