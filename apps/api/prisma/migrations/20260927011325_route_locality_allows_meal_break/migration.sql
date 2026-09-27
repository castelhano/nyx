-- allowsMealBreak moves from the locality to the route stop: the same locality may allow
-- the meal break on one line and not on another
ALTER TABLE "transit_route_localities" ADD COLUMN "allowsMealBreak" BOOLEAN NOT NULL DEFAULT false;

UPDATE "transit_route_localities" rl SET "allowsMealBreak" = true
FROM "transit_localities" l
WHERE rl."localityId" = l."id" AND l."allowsMealBreak";

ALTER TABLE "transit_localities" DROP COLUMN "allowsMealBreak";
