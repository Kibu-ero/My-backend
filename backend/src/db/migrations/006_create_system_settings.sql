-- Create system_settings table
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create water_rates table for flexible rate management
CREATE TABLE IF NOT EXISTS water_rates (
    id SERIAL PRIMARY KEY,
    consumption_min INTEGER NOT NULL,
    consumption_max INTEGER,
    rate_per_cubic_meter DECIMAL(10,2),
    fixed_amount DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default system settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('system_name', 'BillLink Water Management System', 'Name of the water management system'),
('company_name', 'Dolores Water District', 'Name of the water district/company'),
('contact_email', 'conniecalibuso310@gmail.com', 'Contact email address'),
('water_rate', '0', 'Default water rate per cubic meter (if not using rate table)'),
('late_payment_fee', '50', 'Late payment fee in pesos'),
('due_date_grace_period', '3', 'Grace period in days after due date'),
('email_notifications', 'true', 'Enable email notifications'),
('maintenance_mode', 'false', 'System maintenance mode'),
('backup_frequency', 'daily', 'Backup frequency'),
('max_login_attempts', '3', 'Maximum login attempts before lockout'),
('session_timeout', '30', 'Session timeout in minutes'),
('senior_citizen_discount', '5', 'Senior citizen discount percentage')
ON CONFLICT (setting_key) DO NOTHING;

-- Insert default water rates (based on current hardcoded rates)
INSERT INTO water_rates (consumption_min, consumption_max, fixed_amount, is_active) VALUES
(10, 10, 267, true),
(11, 11, 295, true),
(12, 12, 323, true),
(13, 13, 351, true),
(14, 14, 379, true),
(15, 15, 407, true),
(16, 16, 435, true),
(17, 17, 463, true),
(18, 18, 491, true),
(19, 19, 519, true),
(20, 20, 547, true),
(21, 21, 577, true),
(22, 22, 607, true),
(23, 23, 637, true),
(24, 24, 667, true),
(25, 25, 697, true),
(26, 26, 727, true),
(27, 27, 757, true),
(28, 28, 787, true),
(29, 29, 817, true),
(30, 30, 847, true),
(31, 31, 879, true),
(32, 32, 911, true),
(33, 33, 943, true),
(34, 34, 975, true),
(35, 35, 1007, true),
(36, 36, 1039, true),
(37, 37, 1071, true),
(38, 38, 1103, true),
(39, 39, 1135, true),
(40, 40, 1167, true),
(41, 41, 1202, true),
(42, 42, 1237, true),
(43, 43, 1271, true),
(44, 44, 1305, true),
(45, 45, 1340, true),
(46, 46, 1374, true),
(47, 47, 1408, true),
(48, 48, 1443, true),
(49, 49, 1477, true),
(50, 50, 1512, true),
(51, 51, 1547, true),
(52, 52, 1581, true),
(53, 53, 1616, true),
(54, 54, 1650, true),
(55, 55, 1685, true),
(56, 56, 1719, true),
(57, 57, 1753, true),
(58, 58, 1788, true),
(59, 59, 1822, true),
(60, 60, 1857, true),
(61, 61, 1891, true),
(62, 62, 1925, true),
(63, 63, 1960, true),
(64, 64, 1994, true),
(65, 65, 2029, true),
(66, 66, 2063, true),
(67, 67, 2098, true),
(68, 68, 2132, true),
(69, 69, 2166, true),
(70, 70, 2201, true),
(71, 71, 2235, true),
(72, 72, 2270, true),
(73, 73, 2304, true),
(74, 74, 2339, true),
(75, 75, 2373, true),
(76, 76, 2408, true),
(77, 77, 2442, true),
(78, 78, 2477, true),
(79, 79, 2511, true),
(80, 80, 2546, true),
(81, 81, 2580, true),
(82, 82, 2615, true),
(83, 83, 2649, true),
(84, 84, 2684, true),
(85, 85, 2718, true),
(86, 86, 2753, true),
(87, 87, 2787, true),
(88, 88, 2822, true),
(89, 89, 2856, true),
(90, 90, 2891, true),
(91, 91, 2925, true),
(92, 92, 2960, true),
(93, 93, 2994, true),
(94, 94, 3029, true),
(95, 95, 3063, true),
(96, 96, 3098, true),
(97, 97, 3132, true),
(98, 98, 3166, true),
(99, 99, 3201, true),
(100, 100, 3235, true),
(101, NULL, NULL, true) -- For consumption > 100 cu.m., use rate_per_cubic_meter = 34.45
ON CONFLICT DO NOTHING;

-- Update the rate for consumption > 100 cu.m.
UPDATE water_rates 
SET rate_per_cubic_meter = 34.45, consumption_min = 101 
WHERE consumption_min = 101;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key);
CREATE INDEX IF NOT EXISTS idx_water_rates_consumption ON water_rates(consumption_min, consumption_max);
CREATE INDEX IF NOT EXISTS idx_water_rates_active ON water_rates(is_active);
