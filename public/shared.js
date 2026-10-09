// Shared by the browser (window.POTLUCK) and the server (require('./public/shared')).
(function (root) {
  // Night shift only for now. To bring the other shifts back, add
  // { id: 'morning', label: 'Morning' } and { id: 'swing', label: 'Swing' } here.
  const SHIFTS = [
    { id: 'graveyard', label: 'Graveyard' }
  ];
  const CATS = [
    { id: 'mains', label: 'Mains', one: 'main', many: 'mains' },
    { id: 'sides', label: 'Sides', one: 'side', many: 'sides' },
    { id: 'snacks', label: 'Snacks & Apps', one: 'snack', many: 'snacks' },
    { id: 'desserts', label: 'Desserts', one: 'dessert', many: 'desserts' },
    { id: 'drinks', label: 'Drinks', one: 'drink', many: 'drinks' },
    { id: 'supplies', label: 'Supplies', one: 'supply', many: 'supplies' }
  ];
  // Thanksgiving list: [label, how many needed per shift]
  const PRESET = {
    mains: [['Roast turkey', 3], ['Glazed ham', 2], ['Fried chicken', 3]],
    sides: [['Stuffing / dressing', 3], ['Mashed potatoes', 3], ['Gravy', 2], ['Candied yams', 3], ['Green bean casserole', 2], ['Baked mac & cheese', 5], ['Collard greens', 3], ['Cranberry sauce', 2], ['Dinner rolls', 3], ['Cornbread', 2]],
    snacks: [['Chips & dip', 3], ['Veggie tray', 2], ['Cheese & crackers', 2], ['Deviled eggs', 2]],
    desserts: [['Pumpkin pie', 3], ['Sweet potato pie', 3], ['Apple pie', 2], ['Peach cobbler', 2], ['Cookies', 2]],
    drinks: [['Soda (2-liters)', 5], ['Sweet tea', 2], ['Bottled water', 3], ['Bag of ice', 3]],
    supplies: [['Plates & bowls', 2], ['Cups', 2], ['Napkins', 2], ['Forks & spoons', 2], ['Serving spoons', 2], ['Foil & to-go containers', 2]]
  };
  const DEFAULT_DEPTS = ['Table Games', 'Slots', 'Cage', 'Security', 'Surveillance', 'Food & Beverage', 'EVS', 'Hotel', 'Players Club', 'Marketing', 'HR', 'Finance', 'IT', 'Facilities'];
  const TAGS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Halal', 'Has nuts', 'Spicy', 'Store-bought'];
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function presetItems() {
    const out = [];
    CATS.forEach(c => (PRESET[c.id] || []).forEach(([l, q]) => out.push({ id: 'tg-' + slug(l), label: l, cat: c.id, qty: q })));
    return out;
  }
  function defaultEvent() {
    return { name: 'Team Thanksgiving Potluck', date: '', place: '', host: '', notes: '', departments: DEFAULT_DEPTS.slice(), items: presetItems() };
  }
  const api = { SHIFTS, CATS, TAGS, DEFAULT_DEPTS, slug, presetItems, defaultEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.POTLUCK = api;
})(this);
