-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'COACH', 'NUTRITIONIST', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "avatar" TEXT NOT NULL DEFAULT 'U',
    "avatarUrl" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION,
    "teamName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kcal" INTEGER NOT NULL DEFAULT 2100,
    "protein" INTEGER NOT NULL DEFAULT 200,
    "carbs" INTEGER NOT NULL DEFAULT 250,
    "fat" INTEGER NOT NULL DEFAULT 70,
    "water" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "steps" INTEGER NOT NULL DEFAULT 10000,
    "sleep" INTEGER NOT NULL DEFAULT 8,
    "weightTarget" DOUBLE PRECISION,
    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TodayLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "waterCups" INTEGER NOT NULL DEFAULT 0,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "sleepScore" INTEGER NOT NULL DEFAULT 0,
    "sleepHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "TodayLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Meal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mealType" TEXT NOT NULL DEFAULT 'Gustare',
    "kcal" INTEGER NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fiber" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "icon" TEXT NOT NULL DEFAULT '🍽️',
    "time" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT "Meal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserExercise" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "libId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "muscle" TEXT NOT NULL,
    "equip" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "sets" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT "UserExercise_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SleepLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "bedTime" TEXT NOT NULL,
    "wakeTime" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "score" INTEGER NOT NULL,
    CONSTRAINT "SleepLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coach" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "membersCount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachAthlete" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "athleteId" TEXT,
    "inviteEmail" TEXT,
    "inviteName" TEXT NOT NULL,
    "inviteToken" TEXT,
    "inviteStatus" TEXT NOT NULL DEFAULT 'pending',
    "plan" TEXT NOT NULL DEFAULT 'Full Body 3x',
    "goal" TEXT NOT NULL DEFAULT 'General',
    "compliance" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION,
    "trend" TEXT NOT NULL DEFAULT 'st',
    "lastActive" TEXT NOT NULL DEFAULT 'acum',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachAthlete_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkoutPlan" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Forță',
    "assignedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkoutPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkoutExercise" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "libId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "muscle" TEXT NOT NULL,
    "equip" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "sets" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkoutAssignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "coachAthleteId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkoutAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachMessage" (
    "id" TEXT NOT NULL,
    "coachAthleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "athleteId" TEXT,
    "fromCoach" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NutClient" (
    "id" TEXT NOT NULL,
    "nutritionistId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT 'Menținere',
    "plan" TEXT NOT NULL DEFAULT 'Menținere',
    "kcalTarget" INTEGER NOT NULL DEFAULT 2000,
    "kcalToday" INTEGER NOT NULL DEFAULT 0,
    "compliance" INTEGER NOT NULL DEFAULT 0,
    "coachName" TEXT NOT NULL DEFAULT '—',
    "lastActive" TEXT NOT NULL DEFAULT 'acum',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NutClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NutTemplate" (
    "id" TEXT NOT NULL,
    "nutritionistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Menținere',
    "kcal" INTEGER NOT NULL DEFAULT 2000,
    "protein" INTEGER NOT NULL DEFAULT 150,
    "carbs" INTEGER NOT NULL DEFAULT 200,
    "fat" INTEGER NOT NULL DEFAULT 70,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NutTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NutTemplateApplication" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NutTemplateApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT,
    "teamId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'fitness',
    "targetValue" INTEGER NOT NULL DEFAULT 30,
    "targetUnit" TEXT NOT NULL DEFAULT 'zile',
    "durationDays" INTEGER NOT NULL DEFAULT 30,
    "imageUrl" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChallengeParticipant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dietType" TEXT NOT NULL DEFAULT 'balanced',
    "allergies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "mealsPerDay" INTEGER NOT NULL DEFAULT 3,
    "eatingWindowStart" TEXT NOT NULL DEFAULT '08:00',
    "eatingWindowEnd" TEXT NOT NULL DEFAULT '20:00',
    "cookingPref" TEXT NOT NULL DEFAULT 'mixed',
    "fitnessGoal" TEXT NOT NULL DEFAULT 'maintain',
    "experienceLevel" TEXT NOT NULL DEFAULT 'beginner',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "actorLabel" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "summary" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'app',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'general',
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Goal_userId_key" ON "Goal"("userId");
CREATE UNIQUE INDEX "TodayLog_userId_key" ON "TodayLog"("userId");
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "TeamMember"("userId", "teamId");
CREATE UNIQUE INDEX "CoachAthlete_inviteToken_key" ON "CoachAthlete"("inviteToken");
CREATE UNIQUE INDEX "WorkoutAssignment_planId_coachAthleteId_key" ON "WorkoutAssignment"("planId", "coachAthleteId");
CREATE UNIQUE INDEX "NutTemplateApplication_templateId_clientId_key" ON "NutTemplateApplication"("templateId", "clientId");
CREATE UNIQUE INDEX "PostLike_userId_postId_key" ON "PostLike"("userId", "postId");
CREATE UNIQUE INDEX "ChallengeParticipant_userId_challengeId_key" ON "ChallengeParticipant"("userId", "challengeId");
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");
CREATE INDEX "AuditEvent_category_idx" ON "AuditEvent"("category");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TodayLog" ADD CONSTRAINT "TodayLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meal" ADD CONSTRAINT "Meal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserExercise" ADD CONSTRAINT "UserExercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SleepLog" ADD CONSTRAINT "SleepLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachAthlete" ADD CONSTRAINT "CoachAthlete_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachAthlete" ADD CONSTRAINT "CoachAthlete_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutAssignment" ADD CONSTRAINT "WorkoutAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutAssignment" ADD CONSTRAINT "WorkoutAssignment_coachAthleteId_fkey" FOREIGN KEY ("coachAthleteId") REFERENCES "CoachAthlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_coachAthleteId_fkey" FOREIGN KEY ("coachAthleteId") REFERENCES "CoachAthlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NutClient" ADD CONSTRAINT "NutClient_nutritionistId_fkey" FOREIGN KEY ("nutritionistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NutClient" ADD CONSTRAINT "NutClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NutTemplateApplication" ADD CONSTRAINT "NutTemplateApplication_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NutTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NutTemplateApplication" ADD CONSTRAINT "NutTemplateApplication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "NutClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
