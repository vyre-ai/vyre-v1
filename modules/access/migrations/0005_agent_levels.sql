-- An agent has three levels: Can use, Can edit, Can manage (owner, 4 Nov). "Can chat with" (View) is merged into Can use, so every stored View grant on an agent becomes Use.
-- A subject that already holds Use on the same agent keeps that row and loses the View one.
DELETE FROM "access_grants" WHERE "resourceType" = 'agent' AND "level" = 'view' AND EXISTS (
  SELECT 1 FROM "access_grants" u WHERE u."resourceType" = 'agent' AND u."resourceId" = "access_grants"."resourceId" AND u."subjectKind" = "access_grants"."subjectKind" AND u."subjectId" = "access_grants"."subjectId" AND u."level" = 'use'
);
UPDATE "access_grants" SET "level" = 'use' WHERE "resourceType" = 'agent' AND "level" = 'view';
