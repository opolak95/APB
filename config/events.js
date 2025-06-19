module.exports = {
  zvz: {
    title: 'ZvZ Event',
    description: 'Velký ZvZ event pro celou gildu.',
    roles: [
      { name: 'Shotcaller', max: 1 },
      { name: 'Tank', max: 5 },
      { name: 'Healer', max: 4 },
      { name: 'DPS', max: 10 },
      { name: 'Scout', max: 2 }
    ]
  },
  ss: {
    title: 'Small Scale Event',
    description: 'Malá skupina na roam / gank.',
    roles: [
      { name: 'Tank', max: 2 },
      { name: 'Healer', max: 2 },
      { name: 'DPS', max: 6 },
      { name: 'Scout', max: 1 }
    ]
  },
  dungeon: {
    title: 'Dungeon Group',
    description: 'Uzavřená skupina na HCE nebo Avalonian Dungeon.',
    roles: [
      { name: 'Tank', max: 1 },
      { name: 'Healer', max: 1 },
      { name: 'DPS', max: 3 }
    ]
  },
  faction: {
    title: 'Faction Warfare',
    description: 'Připoj se k frakční válce!',
    roles: [
      { name: 'Leader', max: 1 },
      { name: 'Tank', max: 4 },
      { name: 'Healer', max: 4 },
      { name: 'DPS', max: 8 }
    ]
  },
  ganking: {
    title: 'Ganking Squad',
    description: 'Malá mobilní skupina na otevřený svět.',
    roles: [
      { name: 'Lead', max: 1 },
      { name: 'Healer', max: 2 },
      { name: 'Dagger', max: 2 },
      { name: 'Other DPS', max: 5 },
      { name: 'Scout', max: 1 }
    ]
  },
  arena: {
    title: 'Arena Practice',
    description: 'Tréninková session pro 5v5 nebo Crystal League.',
    roles: [
      { name: 'Tank', max: 1 },
      { name: 'Healer', max: 1 },
      { name: 'DPS', max: 3 }
    ]
  }
};
