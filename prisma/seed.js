import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');
  const pw = await bcrypt.hash('demo1234', 12);

  // ── USERS ─────────────────────────────────────────────────────────────
  const users = [
    { email: 'user@forja.ro',          name: 'Alex Popescu',      role: 'USER',         plan: 'PRO',   avatar: 'A', streak: 12, xp: 1340, level: 7, weight: 78, goal: 'Masă musculară', bio: '' },
    { email: 'coach@forja.ro',         name: 'Mihai Ionescu',     role: 'COACH',        plan: 'COACH', avatar: 'M', streak: 8,  xp: 980,  level: 5, weight: 85, goal: '', bio: 'Coach certificat cu 8 ani experiență. Specializat în powerlifting și forță generală.', specialization: 'Powerlifting', certifications: 'NASM-CPT\nUSA Powerlifting Coach', experience: 8 },
    { email: 'nutritionist@forja.ro',  name: 'Elena Dumitrescu',  role: 'NUTRITIONIST', plan: 'NUT',   avatar: 'E', streak: 6,  xp: 720,  level: 4, weight: 62, goal: '', bio: 'Nutriționist certificat, master în dietetică.', specialization: 'Nutriție sportivă', certifications: 'Master dietetică\nCISSN', experience: 6 },
    { email: 'admin@forja.ro',         name: 'Admin FORJA',       role: 'ADMIN',        plan: 'PRO',   avatar: 'A', streak: 30, xp: 5000, level: 10, weight: 80, goal: '', bio: '' },
    { email: 'maria.s@forja.ro',       name: 'Maria Stancu',      role: 'USER',         plan: 'FREE',  avatar: 'M', streak: 5,  xp: 180,  level: 2, weight: 64, goal: 'Slăbire', bio: '' },
    { email: 'andrei.m@forja.ro',      name: 'Andrei Marin',      role: 'USER',         plan: 'PRO',   avatar: 'A', streak: 18, xp: 1200, level: 6, weight: 82, goal: 'Masă musculară', bio: '' },
    { email: 'dan.g@forja.ro',         name: 'Dan Gheorghe',      role: 'USER',         plan: 'FREE',  avatar: 'D', streak: 9,  xp: 600,  level: 4, weight: 76, goal: 'Menținere', bio: '' },
    { email: 'ioana.p@forja.ro',       name: 'Ioana Preda',       role: 'USER',         plan: 'PRO',   avatar: 'I', streak: 4,  xp: 420,  level: 3, weight: 58, goal: 'Slăbire', bio: '' },
    { email: 'radu.p@forja.ro',        name: 'Radu Petrescu',     role: 'COACH',        plan: 'COACH', avatar: 'R', streak: 11, xp: 650,  level: 3, weight: 88, goal: '', bio: 'Coach bodybuilding. Pregătire competiții, masă musculară, definiție.', specialization: 'Bodybuilding', certifications: 'IFBB-PRO\nISSA', experience: 5 },
    { email: 'ana.v@forja.ro',         name: 'Ana Vasilescu',     role: 'COACH',        plan: 'COACH', avatar: 'A', streak: 15, xp: 800,  level: 4, weight: 60, goal: '', bio: 'Coach endurance & running.', specialization: 'Running / Endurance', certifications: 'RRCA Certified', experience: 7 },
    { email: 'ana.mo@forja.ro',        name: 'Ana Moldovan',      role: 'NUTRITIONIST', plan: 'NUT',   avatar: 'A', streak: 8,  xp: 920,  level: 6, weight: 63, goal: '', bio: 'Nutriționist sportiv specializat pe endurance.', specialization: 'Nutriție sportivă - endurance', certifications: 'Master dietetică', experience: 4 },
  ];

  const saved = {};
  for (const u of users) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, password: pw, isDemo: true },
    });
    saved[u.email] = row;
  }
  console.log(`✔ ${Object.keys(saved).length} users`);

  // Goals
  await Promise.all(Object.values(saved).map((user) => prisma.userGoals.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      kcal: user.role === 'NUTRITIONIST' ? 1800 : (user.weight || 0) > 80 ? 2400 : 2200,
      protein: user.goal === 'Masă musculară' ? 180 : 150,
      carbs: 250, fat: 70, water: 3, steps: 10000, sleep: 8,
    },
  })));

  // ── TEAMS ─────────────────────────────────────────────────────────────
  const teams = [
    { slug: 'iron-wolves',  name: 'Iron Wolves',  category: 'Powerlifting', isPublic: true,  teamType: 'PAID',    description: 'Echipa de powerlifting pentru competiții naționale.', owner: 'coach@forja.ro',   avatarUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80' },
    { slug: 'cardio-crew',  name: 'Cardio Crew',  category: 'Cardio',       isPublic: true,  teamType: 'FREE',    description: 'Running, cycling și HIIT pentru rezistență maximă.',   owner: 'ana.v@forja.ro',    avatarUrl: 'https://images.unsplash.com/photo-1502904550040-7534597429ae?w=400&q=80' },
    { slug: 'flex-nation',  name: 'Flex Nation',  category: 'Bodybuilding', isPublic: true,  teamType: 'PAID',    description: 'Masă musculară, definiție și pregătire competiții.',    owner: 'radu.p@forja.ro',   avatarUrl: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&q=80' },
    { slug: 'war-ready',    name: 'War Ready',    category: 'Funcțional',   isPublic: false, teamType: 'PRIVATE', description: 'Antrenament funcțional. Doar prin invitație.',          owner: 'coach@forja.ro',   avatarUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80' },
    { slug: 'runners-club', name: 'Runners Club', category: 'Cardio',       isPublic: true,  teamType: 'FREE',    description: 'Club gratuit de alergare.',                             owner: 'ana.v@forja.ro',    avatarUrl: 'https://images.unsplash.com/photo-1502904550040-7534597429ae?w=400&q=80' },
    { slug: 'elite-squad',  name: 'Elite Squad',  category: 'Powerlifting', isPublic: false, teamType: 'PRIVATE', description: 'Echipă privată pentru competitori avansați.',           owner: 'coach@forja.ro',   avatarUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80' },
  ];

  const savedTeams = {};
  for (const t of teams) {
    const row = await prisma.team.upsert({
      where: { slug: t.slug },
      update: {},
      create: {
        name: t.name, slug: t.slug, category: t.category,
        isPublic: t.isPublic, teamType: t.teamType, description: t.description,
        avatarUrl: t.avatarUrl,
      },
    });
    savedTeams[t.slug] = row;
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId: saved[t.owner].id, teamId: row.id } },
      update: {},
      create: { userId: saved[t.owner].id, teamId: row.id, role: 'OWNER' },
    });
  }
  console.log(`✔ ${Object.keys(savedTeams).length} teams`);

  // ── MEMBERSHIPS ───────────────────────────────────────────────────────
  const memberships = [
    ['user@forja.ro',    'iron-wolves', 'MEMBER'],
    ['maria.s@forja.ro', 'iron-wolves', 'MEMBER'],
    ['andrei.m@forja.ro','iron-wolves', 'ADMIN'],
    ['dan.g@forja.ro',   'iron-wolves', 'MEMBER'],
    ['user@forja.ro',    'cardio-crew', 'MEMBER'],
  ];
  for (const [email, slug, role] of memberships) {
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId: saved[email].id, teamId: savedTeams[slug].id } },
      update: {},
      create: { userId: saved[email].id, teamId: savedTeams[slug].id, role },
    });
  }

  // ── FEED POSTS ────────────────────────────────────────────────────────
  const postsData = [
    { author: 'coach@forja.ro',        team: null,            content: '💪 Noul program Push/Pull/Legs e live! Rezultate garantate în 12 săptămâni.' },
    { author: 'nutritionist@forja.ro', team: null,            content: '🥗 Rețetă nouă: Bowl proteic cu quinoa, somon și avocado. 650 kcal, 42g proteine!' },
    { author: 'user@forja.ro',         team: null,            content: '🏆 PR nou la bench: 100kg! Mulțumesc Mihai pentru program.' },
    { author: 'coach@forja.ro',        team: 'iron-wolves',   content: '💪 Antrenamentul de azi: Push Day A. Toată lumea la sală la 10:00!' },
    { author: 'user@forja.ro',         team: 'iron-wolves',   content: '🏆 PR nou la bench: 100kg!' },
    { author: 'andrei.m@forja.ro',     team: 'iron-wolves',   content: '🥗 Meal prep done pentru toată săptămâna.' },
    { author: 'ana.v@forja.ro',        team: 'cardio-crew',   content: '🏃‍♀️ Duminică avem alergare lungă. Hidratare bună și mic dejun lejer înainte.' },
  ];

  const savedPosts = [];
  for (const p of postsData) {
    const created = await prisma.post.create({
      data: {
        content: p.content,
        authorId: saved[p.author].id,
        teamId: p.team ? savedTeams[p.team].id : null,
        likes: 0,
      },
    });
    savedPosts.push(created);
  }
  console.log(`✔ ${savedPosts.length} feed posts`);

  // Comments
  await prisma.comment.create({ data: { content: 'Abia aștept! 🔥',        authorId: saved['user@forja.ro'].id,    postId: savedPosts[0].id } });
  await prisma.comment.create({ data: { content: 'Mă înscriu și eu!',      authorId: saved['maria.s@forja.ro'].id, postId: savedPosts[0].id } });
  await prisma.comment.create({ data: { content: 'Arată incredibil! 🤤',   authorId: saved['user@forja.ro'].id,    postId: savedPosts[1].id } });
  await prisma.comment.create({ data: { content: 'Ajung la timp! 🔥',      authorId: saved['user@forja.ro'].id,    postId: savedPosts[3].id } });
  await prisma.comment.create({ data: { content: 'Bravo! Urcăm spre 110.', authorId: saved['coach@forja.ro'].id,   postId: savedPosts[4].id } });
  await prisma.comment.create({ data: { content: 'Monstru! 💪',            authorId: saved['dan.g@forja.ro'].id,   postId: savedPosts[4].id } });

  // Likes
  const likesToCreate = [
    { post: 0, users: ['user@forja.ro', 'maria.s@forja.ro', 'andrei.m@forja.ro'] },
    { post: 1, users: ['user@forja.ro', 'maria.s@forja.ro'] },
    { post: 2, users: ['coach@forja.ro', 'andrei.m@forja.ro'] },
    { post: 3, users: ['user@forja.ro', 'maria.s@forja.ro'] },
    { post: 4, users: ['coach@forja.ro', 'andrei.m@forja.ro', 'dan.g@forja.ro'] },
  ];
  for (const { post, users: emails } of likesToCreate) {
    for (const email of emails) {
      await prisma.like.upsert({
        where: { postId_userId: { postId: savedPosts[post].id, userId: saved[email].id } },
        update: {},
        create: { postId: savedPosts[post].id, userId: saved[email].id },
      });
    }
    await prisma.post.update({
      where: { id: savedPosts[post].id },
      data: { likes: emails.length },
    });
  }
  console.log('✔ comments + likes');

  // ── COACH / ATHLETE LINKS ─────────────────────────────────────────────
  const coachLinks = [
    ['coach@forja.ro', 'user@forja.ro',    'ACCEPTED', 'Atlet cu potențial mare la powerlifting.'],
    ['coach@forja.ro', 'maria.s@forja.ro', 'ACCEPTED', 'Începător motivat, focus pe formă.'],
    ['coach@forja.ro', 'andrei.m@forja.ro','ACCEPTED', 'Experiență 3 ani, pregătire competiție.'],
    ['coach@forja.ro', 'dan.g@forja.ro',   'ACCEPTED', 'Menținere, focus pe consistență.'],
    ['coach@forja.ro', 'ioana.p@forja.ro', 'PENDING',  ''],
  ];
  for (const [coach, athlete, status, notes] of coachLinks) {
    await prisma.coachClient.upsert({
      where: { coachId_athleteId: { coachId: saved[coach].id, athleteId: saved[athlete].id } },
      update: {},
      create: { coachId: saved[coach].id, athleteId: saved[athlete].id, status, notes },
    });
  }

  // ── NUT TEMPLATES ─────────────────────────────────────────────────────
  const templates = [
    {
      name: 'High Protein',  kcal: 2200, protein: 180, carbs: 220, fat: 65,
      mealPlan: [
        { type: 'Mic dejun', name: '3 ouă + pâine integrală + avocado', kcal: 450, p: 28, c: 35, f: 22 },
        { type: 'Gustare 1', name: 'Iaurt grecesc + banană + nuci',     kcal: 280, p: 22, c: 30, f: 10 },
        { type: 'Prânz',     name: 'Piept de pui + orez + broccoli',    kcal: 550, p: 48, c: 55, f: 12 },
        { type: 'Gustare 2', name: 'Shake proteic + biscuiți ovăz',     kcal: 320, p: 38, c: 28, f: 8 },
        { type: 'Cină',      name: 'Somon + cartofi dulci + salată',     kcal: 600, p: 44, c: 72, f: 13 },
      ],
      description: 'Plan hipercaloric bogat în proteine pentru masă musculară.',
    },
    {
      name: 'Deficit moderat', kcal: 1600, protein: 140, carbs: 150, fat: 50,
      mealPlan: [
        { type: 'Mic dejun', name: 'Omletă cu legume',      kcal: 350, p: 28, c: 15, f: 18 },
        { type: 'Prânz',     name: 'Salată pui + quinoa',   kcal: 480, p: 42, c: 40, f: 14 },
        { type: 'Gustare',   name: 'Măr + unt de arahide',  kcal: 250, p: 8,  c: 30, f: 12 },
        { type: 'Cină',      name: 'Cod + legume la cuptor', kcal: 420, p: 38, c: 35, f: 12 },
      ],
      description: 'Deficit de 500 kcal pentru slăbire.',
    },
    {
      name: 'Echilibrat', kcal: 2000, protein: 160, carbs: 200, fat: 60,
      mealPlan: [
        { type: 'Mic dejun', name: 'Overnight oats', kcal: 420, p: 22, c: 55, f: 14 },
      ],
      description: 'Plan echilibrat pentru menținere.',
    },
  ];
  for (const t of templates) {
    const created = await prisma.nutTemplate.create({
      data: {
        name: t.name, kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat,
        authorId: saved['nutritionist@forja.ro'].id,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: saved['nutritionist@forja.ro'].id,
        action: `NUT_TEMPLATE_META:${created.id}`,
        type: 'nutrition-template',
        status: 'ACTION',
        detail: JSON.stringify({ mealPlan: t.mealPlan, description: t.description }),
      },
    });
  }
  console.log(`✔ ${templates.length} nutrition templates`);

  // Assign the High Protein plan to Alex
  const firstTemplate = await prisma.nutTemplate.findFirst({ where: { name: 'High Protein' } });
  if (firstTemplate) {
    await prisma.nutClient.upsert({
      where: { nutritionistId_clientId: { nutritionistId: saved['nutritionist@forja.ro'].id, clientId: saved['user@forja.ro'].id } },
      update: {},
      create: { nutritionistId: saved['nutritionist@forja.ro'].id, clientId: saved['user@forja.ro'].id, status: 'ACCEPTED', templateId: firstTemplate.id },
    });
  }

  // ── ALEX'S DEFAULT WORKOUT PLAN (Push Day A) ──────────────────────────
  const existingPlan = await prisma.workout.findFirst({ where: { userId: saved['user@forja.ro'].id, status: { startsWith: 'PLAN:' } } });
  if (!existingPlan) {
    await prisma.workout.create({
      data: {
        userId: saved['user@forja.ro'].id,
        name: 'Push Day A',
        status: 'PLAN:SELF',
        exercises: {
          create: [
            { name: 'Bench Press',      sets: 4, reps: 8,  restSec: 120, order: 0 },
            { name: 'Incline DB Press', sets: 3, reps: 10, restSec: 90,  order: 1 },
            { name: 'Cable Fly',        sets: 3, reps: 12, restSec: 60,  order: 2 },
            { name: 'OHP',              sets: 4, reps: 6,  restSec: 120, order: 3 },
            { name: 'Lateral Raise',    sets: 3, reps: 15, restSec: 60,  order: 4 },
            { name: 'Tricep Pushdown',  sets: 3, reps: 12, restSec: 60,  order: 5 },
          ],
        },
      },
    });
  }
  console.log('✔ workout plan for user@forja.ro');

  // ── SLEEP ENTRIES (7 days for Alex) ───────────────────────────────────
  const now = new Date();
  const sleepHistory = [
    { offset: 6, bed: '22:45', wake: '05:15', hours: 6.5, quality: 3, score: 65 },
    { offset: 5, bed: '23:00', wake: '06:00', hours: 7.0, quality: 3, score: 72 },
    { offset: 4, bed: '22:30', wake: '06:30', hours: 8.0, quality: 5, score: 90 },
    { offset: 3, bed: '23:15', wake: '06:45', hours: 7.5, quality: 4, score: 80 },
    { offset: 2, bed: '00:00', wake: '06:00', hours: 6.0, quality: 2, score: 58 },
    { offset: 1, bed: '23:15', wake: '06:45', hours: 7.5, quality: 4, score: 85 },
    { offset: 0, bed: '23:15', wake: '06:45', hours: 7.5, quality: 4, score: 82 },
  ];
  for (const s of sleepHistory) {
    const date = new Date(now);
    date.setDate(date.getDate() - s.offset);
    date.setHours(8, 0, 0, 0);
    await prisma.sleepEntry.create({
      data: {
        userId: saved['user@forja.ro'].id,
        date, bedTime: s.bed, wakeTime: s.wake,
        hours: s.hours, quality: s.quality, score: s.score,
      },
    });
  }
  console.log('✔ 7 days of sleep history');

  // ── MEALS FOR TODAY (Alex) ────────────────────────────────────────────
  await prisma.nutritionLog.create({
    data: { userId: saved['user@forja.ro'].id, mealType: 'Mic dejun', foodName: 'Ouă + pâine integrală', kcal: 380, protein: 24, carbs: 32, fat: 18 },
  });
  await prisma.nutritionLog.create({
    data: { userId: saved['user@forja.ro'].id, mealType: 'Pranz',     foodName: 'Piept de pui + orez',   kcal: 520, protein: 48, carbs: 55, fat: 10 },
  });
  await prisma.nutritionLog.create({
    data: { userId: saved['user@forja.ro'].id, mealType: 'WATER', foodName: 'Apă', quantity: 5, kcal: 0, protein: 0, carbs: 0, fat: 0 },
  });
  console.log('✔ today\'s meals + water for Alex');

  // ── ACHIEVEMENTS (Alex) ───────────────────────────────────────────────
  const badges = [
    { badge: 'b1', title: 'Prima săptămână completă' },
    { badge: 'b3', title: 'Streak 10 zile' },
    { badge: 'b10', title: 'Primul PR' },
  ];
  for (const b of badges) {
    await prisma.userAchievement.upsert({
      where: { userId_badge: { userId: saved['user@forja.ro'].id, badge: b.badge } },
      update: {},
      create: { userId: saved['user@forja.ro'].id, ...b },
    });
  }
  console.log(`✔ ${badges.length} achievements`);

  // ── APP SETTINGS ──────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      userId: saved['admin@forja.ro'].id,
      action: 'APP_SETTINGS',
      type: 'settings',
      status: 'SUCCESS',
      detail: JSON.stringify({
        allowPublicSignup: true,
        allowWaitlist: true,
        allowContact: true,
        maintenanceMode: false,
      }),
    },
  });

  // ── CONTACT/WAITLIST SAMPLES ──────────────────────────────────────────
  await prisma.contactSubmission.upsert({
    where: { id: 'sample-contact-1' },
    update: {},
    create: {
      id: 'sample-contact-1', type: 'contact', status: 'nou',
      name: 'Cristina M.', email: 'cm@co.ro',
      subject: 'Plan business', message: 'Plan business 50 angajați.',
    },
  });
  await prisma.contactSubmission.upsert({
    where: { id: 'sample-waitlist-1' },
    update: {},
    create: {
      id: 'sample-waitlist-1', type: 'waitlist:app', status: 'nou',
      name: 'Waitlist', email: 'ion@gmail.com',
      subject: 'waitlist', message: 'Înscris pe lista de așteptare.',
    },
  });

  console.log('');
  console.log('✅ Seed complete!');
  console.log('   Demo accounts: user@forja.ro / coach@forja.ro / nutritionist@forja.ro / admin@forja.ro');
  console.log('   Password for all: demo1234');
}

main().catch((err) => {
  console.error('✘ Seed failed:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
