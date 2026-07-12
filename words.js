/**
 * words.js — Shared category/word dictionary.
 * Loaded by the browser (window.IMPOSTER_WORDS) and required by the
 * Node server (module.exports). No build step needed.
 */
(function (root, factory) {
  const dict = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = dict; // Node (server.js)
  }
  if (typeof window !== "undefined") {
    window.IMPOSTER_WORDS = dict; // Browser (app.js)
  }
})(this, function () {
  return {
    "Food & Drink": [
      "Pizza", "Sushi", "Tacos", "Croissant", "Ramen", "Cheeseburger",
      "Pancakes", "Guacamole", "Espresso", "Bubble Tea", "Lasagna", "Popcorn"
    ],
    "Places": [
      "Paris", "The Moon", "Airport", "Haunted House", "Beach", "Library",
      "Casino", "Submarine", "Mount Everest", "Grocery Store", "Sauna", "Desert Island"
    ],
    "Careers": [
      "Astronaut", "Firefighter", "Dentist", "Magician", "Barista", "Surgeon",
      "Detective", "DJ", "Lifeguard", "Archaeologist", "Chef", "Pilot"
    ],
    "Animals": [
      "Penguin", "Octopus", "Kangaroo", "Sloth", "Flamingo", "Chameleon",
      "Hedgehog", "Great White Shark", "Llama", "Owl", "Panda", "Jellyfish"
    ],
    "Movies & TV": [
      "Titanic", "Jurassic Park", "The Office", "Star Wars", "Shrek",
      "Stranger Things", "Harry Potter", "Finding Nemo", "Squid Game",
      "The Lion King", "Breaking Bad", "Frozen"
    ],
    "Sports & Games": [
      "Chess", "Bowling", "Surfing", "Marathon", "Poker", "Dodgeball",
      "Figure Skating", "Rock Climbing", "Table Tennis", "Golf", "Karaoke", "Darts"
    ],
    "Household Objects": [
      "Toaster", "Umbrella", "Vacuum Cleaner", "Alarm Clock", "Scissors",
      "Candle", "Blender", "Mirror", "Doormat", "Stapler", "Bathtub", "Remote Control"
    ],
    "Famous Landmarks": [
      "Eiffel Tower", "Great Wall of China", "Statue of Liberty", "Pyramids of Giza",
      "Big Ben", "Golden Gate Bridge", "Colosseum", "Taj Mahal",
      "Stonehenge", "Niagara Falls", "Mount Rushmore", "Sydney Opera House"
    ]
  };
});
