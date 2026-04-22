export const EXERCISE_LIBRARY = [
  { id: '10', name: 'Squat',             muscle: 'Picioare', equip: 'Bară',      icon: '🦵', sets: '4×8',  detail: '100 kg', img: 'https://images.unsplash.com/photo-1567598508481-65985588e295?w=200&q=80', anim: '/img/ex-squat.svg' },
  { id: '11', name: 'Deadlift',          muscle: 'Spate',    equip: 'Bară',      icon: '⚡', sets: '3×5',  detail: '120 kg', img: 'https://images.unsplash.com/photo-1603287681836-b174ce5074c2?w=200&q=80', anim: '/img/ex-deadlift.svg' },
  { id: '12', name: 'Bench Press',       muscle: 'Piept',    equip: 'Bară',      icon: '🏋️', sets: '4×8',  detail: '80 kg',  img: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=200&q=80', anim: '/img/ex-bench.svg' },
  { id: '13', name: 'Incline DB Press',  muscle: 'Piept',    equip: 'Gantere',   icon: '📈', sets: '3×10', detail: '30 kg',  img: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=200&q=80', anim: '/img/ex-incline.svg' },
  { id: '14', name: 'Lateral Raise',     muscle: 'Umeri',    equip: 'Gantere',   icon: '↔️', sets: '4×12', detail: '12 kg',  img: 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=200&q=80', anim: '/img/ex-lateral-raise.svg' },
  { id: '15', name: 'Bicep Curl',        muscle: 'Brațe',    equip: 'Gantere',   icon: '💪', sets: '3×12', detail: '16 kg',  img: '/img/ex-bicep-curl.svg', anim: '/img/ex-bicep-curl.svg' },
  { id: '16', name: 'Cable Fly',         muscle: 'Piept',    equip: 'Cablu',     icon: '🦅', sets: '4×12', detail: '15 kg',  img: 'https://images.unsplash.com/photo-1534368786749-b63e05c92717?w=200&q=80', anim: '/img/ex-cable-fly.svg' },
  { id: '17', name: 'OHP',               muscle: 'Umeri',    equip: 'Bară',      icon: '🎯', sets: '4×6',  detail: '50 kg',  img: 'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?w=200&q=80', anim: '/img/ex-ohp.svg' },
  { id: '18', name: 'Plank',             muscle: 'Core',     equip: 'Bodyweight',icon: '🧘', sets: '3×60s',detail: 'Timp',   img: '/img/ex-plank.svg', anim: '/img/ex-plank.svg' },
  { id: '19', name: 'Pull Up',           muscle: 'Spate',    equip: 'Bară',      icon: '🔝', sets: '4×8',  detail: 'BW',     img: '/img/ex-pullup.svg', anim: '/img/ex-pullup.svg' },
  { id: '20', name: 'Leg Press',         muscle: 'Picioare', equip: 'Aparat',    icon: '🦵', sets: '4×10', detail: '180 kg', img: '/img/ex-squat.svg', anim: '/img/ex-squat.svg' },
  { id: '21', name: 'Lunges',            muscle: 'Picioare', equip: 'Bodyweight',icon: '🚶', sets: '3×12', detail: 'BW',     img: '/img/ex-lunge.svg', anim: '/img/ex-lunge.svg' },
  { id: '22', name: 'Tricep Pushdown',   muscle: 'Brațe',    equip: 'Cablu',     icon: '💪', sets: '3×12', detail: '25 kg',  img: 'https://images.unsplash.com/photo-1530822847156-5df684ec5ee1?w=200&q=80', anim: '/img/ex-tricep.svg' },
  { id: '23', name: 'Romanian Deadlift', muscle: 'Picioare', equip: 'Bară',      icon: '🏋️', sets: '3×10', detail: '80 kg',  img: 'https://images.unsplash.com/photo-1603287681836-b174ce5074c2?w=200&q=80', anim: '/img/ex-deadlift.svg' },
  { id: '24', name: 'Push-Up',           muscle: 'Piept',    equip: 'Bodyweight',icon: '✋', sets: '3×20', detail: 'BW',     img: '/img/ex-pushup.svg', anim: '/img/ex-pushup.svg' },
  { id: '25', name: 'Running',           muscle: 'Cardio',   equip: 'Niciunul',  icon: '🏃', sets: '1×30m',detail: 'Cardio', img: '/img/ex-running.svg', anim: '/img/ex-running.svg' },
];

export const FOOD_DB = [
  { id: 'f1',  name: 'Piept de pui (100g)',  kcal: 165, p: 31,  c: 0,  f: 3.6, fib: 0,   img: 'https://images.unsplash.com/photo-1604503468506-a8da13d82571?w=100&q=80' },
  { id: 'f2',  name: 'Orez alb (100g)',      kcal: 130, p: 2.7, c: 28, f: 0.3, fib: 0.4, img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&q=80' },
  { id: 'f3',  name: 'Ou (1 buc)',           kcal: 72,  p: 6.3, c: 0.4,f: 5,   fib: 0,   img: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&q=80' },
  { id: 'f4',  name: 'Banană (1 medie)',     kcal: 105, p: 1.3, c: 27, f: 0.4, fib: 3.1, img: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=100&q=80' },
  { id: 'f5',  name: 'Lapte (250ml)',        kcal: 150, p: 8,   c: 12, f: 8,   fib: 0,   img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&q=80' },
  { id: 'f6',  name: 'Somon (100g)',         kcal: 208, p: 20,  c: 0,  f: 13,  fib: 0,   img: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=100&q=80' },
  { id: 'f7',  name: 'Broccoli (100g)',      kcal: 34,  p: 2.8, c: 7,  f: 0.4, fib: 2.6, img: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=100&q=80' },
  { id: 'f8',  name: 'Pâine integrală (1f)', kcal: 80,  p: 4,   c: 14, f: 1,   fib: 2,   img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&q=80' },
  { id: 'f9',  name: 'Avocado (½)',          kcal: 120, p: 1.5, c: 6,  f: 11,  fib: 5,   img: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=100&q=80' },
  { id: 'f10', name: 'Iaurt grecesc (150g)', kcal: 100, p: 17,  c: 6,  f: 0.7, fib: 0,   img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=100&q=80' },
];

export function parseSets(spec) {
  const match = String(spec || '').match(/(\d+)[×x](\d+)/);
  if (match) return { sets: Number(match[1]), reps: Number(match[2]) || match[2] };
  return { sets: 3, reps: 10 };
}

export function exerciseById(id) {
  return EXERCISE_LIBRARY.find((item) => String(item.id) === String(id));
}

export function searchExercises({ q, muscle } = {}) {
  const term = String(q || '').trim().toLowerCase();
  const muscleTerm = String(muscle || '').trim().toLowerCase();
  return EXERCISE_LIBRARY.filter((item) => {
    if (muscleTerm && muscleTerm !== 'toate' && item.muscle.toLowerCase() !== muscleTerm) return false;
    if (!term) return true;
    return [item.name, item.muscle, item.equip].some((part) => String(part || '').toLowerCase().includes(term));
  });
}

export function foodById(id) {
  return FOOD_DB.find((item) => String(item.id) === String(id));
}

export function searchFood({ q } = {}) {
  const term = String(q || '').trim().toLowerCase();
  return FOOD_DB.filter((item) => {
    if (!term) return true;
    return item.name.toLowerCase().includes(term);
  });
}
