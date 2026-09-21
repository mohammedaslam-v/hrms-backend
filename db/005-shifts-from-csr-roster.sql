-- ---------------------------------------------------------------------------
-- 005 — real shift hours for the people who have a roster
--
-- Every employee in HRMS currently sits on the table default of 10:00–19:00
-- with Sunday off, because nobody has ever set a shift. `csravailabilities`
-- holds genuine per-weekday hours for part of the company, so this copies them
-- across — but only where the roster can be read without guessing.
--
-- WHAT IS DELIBERATELY SKIPPED, AND WHY
--
--   · More than one start–end pair in a week. `hrms_employees` holds ONE
--     shift_start and ONE shift_end. Picking "the most common" would invent a
--     shift the person does not work.
--
--   · A row starting 00:00 or ending 23:59. That is not a real boundary — it is
--     how this table encodes a shift that crosses midnight, chopped in two so
--     both halves fit inside a named weekday. Abhishek's Wednesday is stored as
--     18:00–23:59 AND 00:00–11:00; copying either half alone is wrong, and
--     `night_shift` cannot rescue it because that flag is 0 for every single
--     person here.
--
--   · Anything under 4h or over 12h. 05:00–23:00 and 00:00–01:00 both appear.
--     Whatever they mean, they are not a shift to judge lateness against.
--
--   · Anyone rostered all seven days, which would leave them with no weekly off
--     and mark every Sunday absent.
--
-- Everyone skipped keeps the default and is listed by the last query, for HR to
-- correct at source rather than have us guess here.
--
-- NOTE ON MEANING: `csravailabilities` is what ticket round-robin joins against
-- to decide who can be handed a ticket right now. It is an availability window,
-- not a contract of employment. It is the best shift data that exists, and it
-- is still worth confirming with HR before it starts driving "Late".
-- ---------------------------------------------------------------------------

-- 1. PREVIEW — run this on its own first. Nothing is written.
SELECT e.employee_code,
       e.full_name,
       a.role,
       CONCAT(e.shift_start, ' – ', e.shift_end) AS current_shift,
       CONCAT(k.shift_start, ' – ', k.shift_end) AS new_shift,
       e.weekly_off                              AS current_off,
       k.week_off                                AS new_off
  FROM (
        SELECT c.customerserviceagent_id AS agent_id,
               MIN(c.start_time) AS shift_start,
               MIN(c.end_time)   AS shift_end,
               CONCAT_WS(',',
                 IF(SUM(c.day = 'monday')    > 0, NULL, 'Mon'),
                 IF(SUM(c.day = 'tuesday')   > 0, NULL, 'Tue'),
                 IF(SUM(c.day = 'wednesday') > 0, NULL, 'Wed'),
                 IF(SUM(c.day = 'thursday')  > 0, NULL, 'Thu'),
                 IF(SUM(c.day = 'friday')    > 0, NULL, 'Fri'),
                 IF(SUM(c.day = 'saturday')  > 0, NULL, 'Sat'),
                 IF(SUM(c.day = 'sunday')    > 0, NULL, 'Sun')
               ) AS week_off
          FROM csravailabilities c
         WHERE c.deleted_at IS NULL
         GROUP BY c.customerserviceagent_id
        HAVING COUNT(DISTINCT CONCAT(c.start_time, '-', c.end_time)) = 1
           AND SUM(c.start_time = '00:00:00') = 0
           AND SUM(c.end_time   = '23:59:00') = 0
           AND MIN(TIMESTAMPDIFF(MINUTE, c.start_time, c.end_time)) BETWEEN 240 AND 720
           AND COUNT(*) = COUNT(DISTINCT c.day)
           AND COUNT(DISTINCT c.day) BETWEEN 4 AND 6
       ) k
  JOIN admins a         ON a.customerserviceagent_id = k.agent_id
                       AND a.deleted_at IS NULL
  JOIN hrms_employees e ON e.admin_id = a.id
                       AND e.date_of_leaving IS NULL
 ORDER BY k.shift_start, e.full_name;


-- 2. THE UPDATE — only after the preview reads correctly.
UPDATE hrms_employees e
  JOIN admins a ON a.id = e.admin_id AND a.deleted_at IS NULL
  JOIN (
        SELECT c.customerserviceagent_id AS agent_id,
               MIN(c.start_time) AS shift_start,
               MIN(c.end_time)   AS shift_end,
               CONCAT_WS(',',
                 IF(SUM(c.day = 'monday')    > 0, NULL, 'Mon'),
                 IF(SUM(c.day = 'tuesday')   > 0, NULL, 'Tue'),
                 IF(SUM(c.day = 'wednesday') > 0, NULL, 'Wed'),
                 IF(SUM(c.day = 'thursday')  > 0, NULL, 'Thu'),
                 IF(SUM(c.day = 'friday')    > 0, NULL, 'Fri'),
                 IF(SUM(c.day = 'saturday')  > 0, NULL, 'Sat'),
                 IF(SUM(c.day = 'sunday')    > 0, NULL, 'Sun')
               ) AS week_off
          FROM csravailabilities c
         WHERE c.deleted_at IS NULL
         GROUP BY c.customerserviceagent_id
        HAVING COUNT(DISTINCT CONCAT(c.start_time, '-', c.end_time)) = 1
           AND SUM(c.start_time = '00:00:00') = 0
           AND SUM(c.end_time   = '23:59:00') = 0
           AND MIN(TIMESTAMPDIFF(MINUTE, c.start_time, c.end_time)) BETWEEN 240 AND 720
           AND COUNT(*) = COUNT(DISTINCT c.day)
           AND COUNT(DISTINCT c.day) BETWEEN 4 AND 6
       ) k ON k.agent_id = a.customerserviceagent_id
   SET e.shift_start = k.shift_start,
       e.shift_end   = k.shift_end,
       e.weekly_off  = k.week_off
 WHERE e.date_of_leaving IS NULL;


-- 3. WHO WAS SKIPPED — the list to send back to HR.
SELECT e.employee_code,
       e.full_name,
       a.role,
       COUNT(DISTINCT CONCAT(c.start_time, '-', c.end_time)) AS patterns,
       COUNT(DISTINCT c.day)                                 AS days_rostered,
       GROUP_CONCAT(DISTINCT CONCAT(c.start_time, '-', c.end_time)
                    ORDER BY c.start_time SEPARATOR '  |  ')  AS found,
       CASE
         WHEN SUM(c.start_time = '00:00:00') > 0
           OR SUM(c.end_time   = '23:59:00') > 0 THEN 'shift crosses midnight — stored as two half-rows'
         WHEN COUNT(DISTINCT CONCAT(c.start_time, '-', c.end_time)) > 1
                                               THEN 'more than one shift pattern in the week'
         WHEN COUNT(DISTINCT c.day) > 6        THEN 'rostered all seven days — no weekly off'
         WHEN COUNT(DISTINCT c.day) < 4        THEN 'fewer than four days rostered'
         ELSE 'shift length is under 4h or over 12h'
       END AS why_skipped
  FROM csravailabilities c
  JOIN admins a         ON a.customerserviceagent_id = c.customerserviceagent_id
                       AND a.deleted_at IS NULL
  JOIN hrms_employees e ON e.admin_id = a.id
                       AND e.date_of_leaving IS NULL
 WHERE c.deleted_at IS NULL
 GROUP BY e.id, e.employee_code, e.full_name, a.role
HAVING NOT (
        patterns = 1
    AND SUM(c.start_time = '00:00:00') = 0
    AND SUM(c.end_time   = '23:59:00') = 0
    AND MIN(TIMESTAMPDIFF(MINUTE, c.start_time, c.end_time)) BETWEEN 240 AND 720
    AND COUNT(*) = COUNT(DISTINCT c.day)
    AND days_rostered BETWEEN 4 AND 6
 )
 ORDER BY why_skipped, e.full_name;
