// Deliberately broken example: this file doesn't even parse, so it fizzles
// during gathering and never reaches the world.
const typo = {
  id: "example:typo",
  name: "Typo",
  setup(api) {
    api.every(1, () => {
      api.broadcast("hello"
    });
  },
};

export default typo;
