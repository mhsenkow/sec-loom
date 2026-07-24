UPDATE holdings h
SET security_id = cm.security_id
FROM cusip_map cm
WHERE cm.cusip = h.cusip
  AND cm.status = 'RESOLVED'
  AND h.security_id IS DISTINCT FROM cm.security_id;
