-- Update Petronas Canada (PECL) client record with specific locations, assets,
-- and monitoring keywords so the AI relevance gate can correctly distinguish
-- BC LNG / NE BC signals from unrelated global LNG news (Alaska, Azerbaijan, etc.)

UPDATE public.clients
SET
  industry = 'energy',
  locations = ARRAY[
    'Northeast BC', 'Peace Region', 'Montney Formation', 'Fort St. John', 'Dawson Creek',
    'Kitimat', 'Prince Rupert', 'Northwest BC', 'Coastal GasLink corridor',
    'Highway 16', 'Skeena', 'Bulkley Valley', 'Terrace BC', 'Smithers BC',
    'British Columbia', 'Northern BC', 'Peace River', 'Alberta'
  ],
  high_value_assets = ARRAY[
    'LNG Canada terminal (Kitimat)',
    'Coastal GasLink pipeline',
    'Progress Energy upstream gas assets (Montney)',
    'Peace Region upstream wells and gathering systems',
    'Prince Rupert Gas Transmission pipeline',
    'Cedar LNG (proposed)',
    'PECL BC upstream operations'
  ],
  monitoring_keywords = ARRAY[
    'Petronas Canada', 'PECL', 'Progress Energy Canada',
    'LNG Canada', 'Coastal GasLink', 'CGL pipeline',
    'BC LNG', 'Kitimat LNG', 'Prince Rupert Gas Transmission',
    'Wet''suwet''en', 'Gidimt''en', 'Unist''ot''en',
    'Peace Region energy', 'Montney gas', 'Northeast BC energy',
    'Stand.earth', 'Dogwood BC', 'Frack Free BC',
    'pipeline protest BC', 'pipeline injunction BC',
    'BC Energy Regulator', 'Canada Energy Regulator LNG'
  ]
WHERE name ILIKE '%Petronas%' OR name ILIKE '%PECL%';
