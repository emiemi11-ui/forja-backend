// Middleware that requires user to be on a specific plan or higher.
// Plans hierarchy: FREE < PRO < TEAM
// COACH/NUT/ADMIN are professional plans — bypass plan locks for their own panels.

const PLAN_LEVEL = { FREE: 0, PRO: 1, TEAM: 2 };

function planLevel(plan) {
  return PLAN_LEVEL[plan] ?? 0;
}

// Allow professional roles (COACH, NUTRITIONIST, ADMIN) to bypass plan checks.
// They have their own panels with their own logic.
function isProfessional(role) {
  return role === 'COACH' || role === 'NUTRITIONIST' || role === 'ADMIN';
}

export function requirePlan(minPlan) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Neautentificat' });
    if (isProfessional(req.user.role)) return next();

    const userLevel = planLevel(req.user.plan);
    const required = planLevel(minPlan);

    if (userLevel < required) {
      return res.status(402).json({
        error: 'plan_required',
        message: `Această funcționalitate necesită planul ${minPlan} sau mai mare.`,
        required: minPlan,
        current: req.user.plan,
      });
    }
    return next();
  };
}

export const requirePro = requirePlan('PRO');
export const requireTeam = requirePlan('TEAM');
