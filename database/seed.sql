-- Optional, clearly identified demo records. Their password_hash is intentionally
-- unusable; sign up with a real account for interactive flows. Delete this data
-- before any production deployment. These are actual database rows, not UI fixtures.
INSERT INTO users(id,full_name,email,phone,password_hash,city,state) VALUES
('11111111-1111-4111-8111-111111111111','Demo Donor (Sample)','sample.donor@example.invalid','+910000000001','disabled-seed','Pune','Maharashtra'),
('22222222-2222-4222-8222-222222222222','Demo Requester (Sample)','sample.requester@example.invalid','+910000000002','disabled-seed','Pune','Maharashtra')
ON CONFLICT (email) DO NOTHING;
INSERT INTO donor_profiles(user_id,blood_group,age,city,state,is_available,contact_preference)
SELECT '11111111-1111-4111-8111-111111111111','O+',28,'Pune','Maharashtra',true,'hidden'
WHERE EXISTS (SELECT 1 FROM users WHERE id='11111111-1111-4111-8111-111111111111')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO blood_requests(id,requester_id,patient_name,blood_group,units_required,hospital_name,city,state,required_date,contact_number,urgency,description)
SELECT '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Sample Patient','O+',1,'Demonstration Hospital','Pune','Maharashtra',CURRENT_DATE+3,'+910000000003','normal','DEMO DATA ONLY: remove before deployment.'
WHERE EXISTS (SELECT 1 FROM users WHERE id='22222222-2222-4222-8222-222222222222')
ON CONFLICT (id) DO NOTHING;
