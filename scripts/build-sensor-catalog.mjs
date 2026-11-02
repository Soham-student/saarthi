import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: node scripts/build-sensor-catalog.mjs <sensor-list.txt>');
  process.exit(1);
}

const categoryDefinitions = [
  ['Engine-related information', 'Engine'],
  ['Fuel-related information', 'Fuel'],
  ['Tyre and wheel information', 'Tyres & wheels'],
  ['Battery and electrical system', 'Battery & electrical'],
  ['Driving behaviour', 'Driving behaviour'],
  ['Braking system', 'Braking'],
  ['Accident and impact information', 'Impact & accident'],
  ['GPS and location information', 'GPS & location'],
  ['External environment information', 'Environment'],
  ['Surrounding vehicle and obstacle information', 'Surroundings & ADAS'],
  ['Driver and passenger information', 'People & cabin safety'],
  ['Transmission and drivetrain', 'Transmission'],
  ['Exhaust and emission information', 'Emissions'],
  ['Vehicle condition and maintenance', 'Maintenance'],
  ['Cabin and comfort information', 'Cabin & comfort'],
];

const sourceByCategory = {
  Engine: 'OBD-II / engine ECU',
  Fuel: 'OBD-II / engine ECU / fuel sensors',
  'Tyres & wheels': 'TPMS / wheel-speed sensors',
  'Battery & electrical': 'BMS / vehicle ECU / electrical sensors',
  'Driving behaviour': 'OBD-II / GPS / IMU',
  Braking: 'ABS / brake ECU / optional wear sensors',
  'Impact & accident': 'Validated crash sensors / IMU / GPS',
  'GPS & location': 'GNSS / navigation ECU',
  Environment: 'Vehicle / ambient / optional IoT sensors',
  'Surroundings & ADAS': 'Validated cameras / radar / ultrasonic / ADAS ECU',
  'People & cabin safety': 'Seat sensors / seatbelt switches / validated driver-monitoring hardware',
  Transmission: 'Transmission ECU / drivetrain sensors',
  Emissions: 'OBD-II / after-treatment sensors',
  Maintenance: 'OBD-II / vehicle ECU / optional component sensors',
  'Cabin & comfort': 'HVAC / cabin sensors / optional IoT sensors',
};

const explicitSamples = new Map(Object.entries({
  'Engine RPM': ['850', 'rpm'], 'Engine temperature': ['91', '°C'], 'Coolant temperature': ['88', '°C'],
  'Engine oil temperature': ['94', '°C'], 'Engine oil pressure': ['2.6', 'bar'], 'Engine load percentage': ['21', '%'],
  'Engine torque': ['132', 'Nm'], 'Engine power': ['18', 'kW'], 'Fuel tank level': ['64', '%'],
  'Intake air temperature': ['32', '°C'], 'Intake manifold pressure': ['101', 'kPa'], 'Intake air pressure': ['99', 'kPa'],
  'Mass air flow (MAF)': ['4.8', 'g/s'], 'Throttle position': ['13', '%'], 'Throttle opening percentage': ['13', '%'],
  'Fuel injection timing': ['12', '° BTDC'], 'Ignition timing': ['8', '° BTDC'], 'Engine operating hours': ['725', 'h'],
  'Engine idle time': ['51', 'h'], 'Engine start/stop status': ['Running · idle', 'sample'], 'Engine misfire count': ['0', 'count · sample'],
  'Engine knocking': ['Not detected', 'sample'], 'Exhaust gas temperature': ['378', '°C'], 'Exhaust pressure': ['102', 'kPa'],
  'Engine fault codes': ['None', 'no active DTC · sample'], 'Engine operating status': ['Idle', 'sample'],
  'Fuel consumed': ['5.8', 'L · trip'], 'Instantaneous fuel consumption': ['6.4', 'L/100 km'],
  'Average fuel consumption': ['7.1', 'L/100 km'], 'Fuel efficiency (km/l)': ['14.1', 'km/L'],
  'Remaining driving range': ['412', 'km'], 'Fuel pressure': ['350', 'kPa'], 'Fuel injection rate': ['2.6', 'g/s · sample'],
  'Fuel type (where supported)': ['Petrol', 'sample'], 'Fuel system status': ['Closed loop', 'sample'],
  'Fuel leakage indicators (with suitable detection hardware)': ['No alert', 'sample'],
  'Individual tyre pressure': ['34', 'PSI · sample wheel'], 'Tyre temperature': ['31', '°C · sample'], 'Front-left tyre pressure': ['34', 'PSI'],
  'Front-right tyre pressure': ['34', 'PSI'], 'Rear-left tyre pressure': ['33', 'PSI'], 'Rear-right tyre pressure': ['33', 'PSI'],
  'Tyre pressure imbalance': ['1', 'PSI · max difference'], 'Tyre pressure loss': ['0', 'PSI/h · sample'],
  'Wheel rotation speed': ['0', 'rpm · parked'], 'Wheel slip': ['0', '% · sample'],
  'Tyre condition indicators (with suitable additional sensors)': ['No alert', 'sample'],
  'Wheel alignment indicators (indirectly, with suitable measurements)': ['No deviation inferred', 'sample'],
  'Battery voltage': ['12.6', 'V · sample LV bus'],
  'Battery current': ['8.2', 'A'], 'Battery temperature': ['27', '°C'], 'Battery charge level': ['86', '%'],
  'Battery health estimate': ['96', '% · estimated'], 'Electrical system voltage': ['13.8', 'V'],
  'Alternator voltage': ['13.8', 'V · sample'], 'Alternator performance': ['Normal · sample', 'state'],
  'Starter motor status': ['Ready · sample', 'state'], 'Electrical load': ['1.4', 'kW'],
  'Charging system status': ['Idle · unplugged', 'sample'], 'Electrical fault codes': ['None', 'no active DTC · sample'],
  'Current speed': ['0', 'km/h'], 'Average speed': ['38', 'km/h · trip'], 'Maximum speed': ['86', 'km/h · trip'],
  'Acceleration': ['0.0', 'm/s²'], 'Deceleration': ['0.0', 'm/s²'], 'Steering angle': ['0', '°'],
  'Sudden acceleration': ['None', 'sample trip events'], 'Sudden braking': ['None', 'sample trip events'],
  'Harsh braking frequency': ['0', 'events · sample trip'], 'Sharp cornering': ['None', 'sample trip events'],
  'Steering rate': ['0', '°/s'], 'Gear position': ['P', 'sample · parked'], 'Gear shifting frequency': ['6', 'shifts · sample trip'],
  'Brake pedal position': ['0', '%'], 'Accelerator pedal position': ['0', '%'], 'Distance travelled': ['18.4', 'km · trip'],
  'Handbrake status': ['Engaged · parked', 'sample'], 'Idle duration': ['00:03', 'hh:mm · trip'],
  'Reverse gear status': ['Off · parked', 'sample'], 'Cruise control status': ['Off', 'sample'],
  'Driving duration': ['00:42', 'hh:mm'], 'Brake pressure': ['0', 'bar · parked'], 'Brake fluid level': ['82', '% · sample'],
  'Brake fluid temperature': ['34', '°C · sample'], 'Brake pedal application': ['Not applied · parked', 'sample'],
  'ABS activation': ['Not active', 'sample'], 'Electronic stability control activation': ['Not active', 'sample'],
  'Brake pad wear (if equipped)': ['18', '% · estimated remaining'], 'Brake disc temperature (with additional sensors)': ['38', '°C · sample'],
  'Brake system fault status': ['Normal · sample', 'state'], 'Parking brake status': ['Engaged · parked', 'sample'],
  'Collision detection': ['No event', 'sample'], 'Collision impact force (estimated)': ['0', 'g · sample'],
  'Sudden deceleration during collision': ['0.0', 'm/s² · sample'], 'Impact direction': ['None', 'no event'],
  'Vehicle rollover detection': ['No event', 'sample'], 'Airbag deployment status': ['Not deployed', 'sample'],
  'Crash sensor activation': ['Not active', 'sample'], 'Vehicle tilt angle': ['0', '° · parked'],
  'Accident timestamp': ['—', 'no event'], 'Accident location': ['—', 'no event'], 'Post-collision vehicle status': ['Normal · no event', 'sample'],
  'Accident timestamp': ['—', 'no event'], 'Accident location': ['—', 'no event'],
  'Current geographical location': ['12.9716, 77.5946', '° · simulated'], 'Latitude': ['12.9716', '° · simulated'],
  'Longitude': ['77.5946', '° · simulated'], 'Altitude': ['920', 'm · simulated'], 'Current route': ['Home → Sample hub', 'demo route'],
  'Total distance travelled': ['18.4', 'km · trip'], 'Travel direction': ['North', 'sample'], 'Vehicle heading': ['0', '° · sample'],
  'Average journey time': ['00:42', 'hh:mm · sample'], 'Stoppage locations': ['None', 'sample trip'], 'Parking location': ['—', 'not parked at saved place'],
  'Geofencing entry/exit': ['No crossing', 'sample'], 'Route deviation': ['None', 'sample route'], 'Time spent at each location': ['00:00', 'hh:mm · sample'],
  'Outside temperature': ['28', '°C · simulated'], 'Humidity': ['48', '% · simulated'], 'Atmospheric pressure': ['101.2', 'kPa · simulated'],
  'Rain detection': ['No rain', 'sample'], 'Light intensity': ['420', 'lux · simulated'], 'Air quality': ['Good', 'sample'],
  'Road surface temperature': ['29', '°C · simulated'], 'Water depth (with appropriate sensors)': ['0', 'mm · sample'],
  'Visibility conditions (using cameras or other sensors)': ['Clear', 'sample'], 'Wind speed (with additional equipment)': ['8', 'km/h · simulated'],
  'Distance from the vehicle ahead': ['42', 'm · simulated'], 'Parking distance': ['1.4', 'm · simulated'],
  'Distance from vehicles behind': ['18', 'm · simulated'], 'Distance from vehicles on either side': ['2.4', 'm · simulated'],
  'Relative speed of nearby vehicles': ['0', 'km/h · sample'], 'Obstacle distance': ['4.2', 'm · simulated'], 'Obstacle direction': ['None', 'sample'],
  'Blind-spot occupancy': ['Not occupied', 'sample'], 'Pedestrian detection': ['None', 'sample'], 'Cyclist detection': ['None', 'sample'],
  'Lane markings': ['Detected', 'sample'], 'Lane departure': ['None', 'sample'], 'Lane change detection': ['None', 'sample'],
  'Traffic sign recognition': ['60 km/h · sample', 'simulated sign'], 'Traffic signal recognition': ['Green · sample', 'simulated signal'],
  'Road curvature': ['Low · sample', 'estimated'], 'Road boundary detection': ['Detected', 'sample'], 'Road obstacle detection': ['None', 'sample'],
  'Driver seat occupancy': ['Occupied', 'sample'], 'Passenger seat occupancy': ['Unoccupied', 'sample'], 'Seatbelt usage': ['Driver buckled', 'sample'],
  'Driver drowsiness indicators': ['No warning', 'sample'], 'Driver eye movement': ['Normal · sample', 'state'], 'Driver head position': ['Forward · sample', 'state'],
  'Driver distraction indicators': ['No warning', 'sample'], 'Steering wheel grip (if equipped)': ['Detected', 'sample'], 'Number of occupants': ['1', 'count · sample'],
  'Door open/close status': ['All closed', 'sample'], 'Window open/close status': ['All closed', 'sample'],
  'Child seat occupancy (if equipped)': ['Not detected', 'sample'], 'Current gear': ['P', 'sample · parked'],
  'Transmission temperature': ['42', '°C · sample'], 'Transmission fluid pressure': ['300', 'kPa · sample'],
  'Transmission fluid temperature': ['42', '°C · sample'], 'Gear shift status': ['Stable · parked', 'sample'],
  'Clutch temperature (if equipped)': ['35', '°C · sample'], 'Clutch engagement status': ['Not engaged · parked', 'sample'],
  'Differential temperature (if equipped)': ['38', '°C · sample'], 'Driveshaft speed': ['0', 'rpm · parked'],
  'Torque distribution': ['Front 100 · rear 0', '% · sample'], 'Four-wheel-drive status': ['Off · sample', 'state'],
  'Oxygen sensor readings': ['0.45', 'V · sample'], 'Exhaust oxygen concentration': ['2.1', '% · sample'],
  'Air-fuel ratio': ['14.7:1', 'sample'], 'Carbon monoxide concentration (with suitable equipment)': ['0', 'ppm · sample'],
  'Nitrogen oxide levels (with suitable equipment)': ['12', 'ppm · sample'], 'Catalytic converter temperature': ['410', '°C · sample'],
  'Catalytic converter efficiency': ['98', '% · estimated'], 'Diesel particulate filter status': ['Not applicable · petrol sample', 'state'],
  'DPF soot loading': ['Not applicable · petrol sample', '%'], 'EGR system status': ['Normal · sample', 'state'],
  'Emission system fault codes': ['None', 'no active DTC · sample'],
  'Odometer reading': ['24,810', 'km · simulated'], 'Cabin temperature': ['22.5', '°C'], 'Cabin humidity': ['44', '%'],
  'AC temperature': ['19', '°C · setpoint'], 'CO₂ concentration (with additional sensors)': ['720', 'ppm · simulated'],
  'Cabin particulate matter (with additional sensors)': ['8', 'µg/m³ · simulated'], 'AC compressor status': ['On · sample', 'state'],
  'Air conditioning pressure': ['850', 'kPa · sample'], 'Cabin air quality': ['Good · sample', 'state'],
  'Window status': ['All closed · sample', 'state'], 'Sunroof status': ['Closed · sample', 'state'],
  'Seat temperature': ['22', '°C · sample'], 'Seat occupancy': ['Driver occupied · sample', 'state'], 'Interior light status': ['Auto · sample', 'state'],
}));

const optionalPattern = /if equipped|if supported|where supported|with suitable|additional sensor|optional|indirectly/i;
const codePattern = /fault code|misfire|knocking|malfunction|failure|leakage|fault status/i;
const eventPattern = /collision|impact|rollover|airbag|crash sensor|drowsiness|drowsy|distraction|slip|sudden acceleration|sudden braking|harsh braking|sharp cornering|lane departure|route deviation|geofenc|seatbelt|seat belt|door open|reverse gear|ABS activation|stability control activation/i;
const measuredPattern = /temperature|pressure|level|voltage|current|load|speed|rate|position|angle|distance|wear|force|concentration|quality|depth|intensity|visibility|humidity|acceleration|deceleration|torque|power|consumption|efficiency|soot|alignment|performance|health|hours|duration|count|frequency|occupancy/i;

function alertRule(name) {
  if (codePattern.test(name)) {
    return { alertable: true, severity: 'warning', trigger: 'Alert when the vehicle ECU reports an active diagnostic code, abnormal misfire/knock, or validated leak signal. Read the vehicle DTC and service guidance; this sample has no active fault.' };
  }
  if (/collision|impact|rollover|airbag|crash sensor/i.test(name)) {
    return { alertable: true, severity: 'critical', trigger: 'Only a validated crash/airbag ECU event can trigger this. Send an OEM-supported emergency notification where available; never infer a crash from this demo or a single generic sensor.' };
  }
  if (/drowsiness|eye movement|head position|distraction|steering wheel grip/i.test(name)) {
    return { alertable: true, severity: 'warning', trigger: 'Only a validated, calibrated driver-monitoring system may emit its own attention/fatigue warning. This field is not a diagnosis; advise a safe stop and rest when the driver feels sleepy.' };
  }
  if (/seatbelt|seat belt|door open|window open|child seat|seat occupancy|seat temperature/i.test(name)) {
    return { alertable: true, severity: 'warning', trigger: 'Use the vehicle-approved seat/door/seatbelt state and OEM policy; e.g. an unbelted occupied seat or door ajar while moving. Do not infer occupant identity.' };
  }
  if (/route deviation|geofenc|stoppage location|parking location|time spent at each location/i.test(name)) {
    return { alertable: true, severity: 'info', trigger: 'Alert only when a user-configured route/geofence or stop-duration rule is crossed and location permission is enabled. Respect consent and privacy.' };
  }
  if (/speed/i.test(name)) {
    return { alertable: true, severity: 'info', trigger: 'Compare with a driver/OEM-configured limit or verified local limit; there is no universal safe-speed threshold.' };
  }
  if (eventPattern.test(name)) {
    return { alertable: true, severity: 'warning', trigger: 'Alert only when the validated subsystem reports this event and its OEM threshold/conditions are satisfied. The signal may be advisory rather than a fault.' };
  }
  if (measuredPattern.test(name)) {
    return { alertable: true, severity: 'warning', trigger: 'Use the make/model/year-specific OEM warning threshold, diagnostic state, and trend. No universal threshold is applied in this sample.' };
  }
  return { alertable: false, severity: 'info', trigger: 'Context/status value. No standalone alert is defined; raise an alert only when an OEM rule or related validated signal requires it.' };
}

function sampleFor(name, id, category) {
  if (explicitSamples.has(name)) {
    const [value, unit] = explicitSamples.get(name);
    return { value, unit };
  }
  const lower = name.toLowerCase();
  if (/fault code/.test(lower)) return { value: 'None', unit: 'no active DTC · sample' };
  if (/fault|malfunction|failure|knocking|misfire|leakage|collision|rollover|airbag|crash sensor|drowsiness|distraction|lane departure|wheel slip|rain detection|pedestrian detection|cyclist detection|blind-spot occupancy|reverse gear status|handbrake status|parking brake status|ABS activation|electronic stability control activation|cruise control status|engine start\/stop status|engine operating status|fuel system status|charging system status|door open\/close status|window open\/close status|seatbelt usage|seatbelt|gear shift status|four-wheel-drive status|maintenance reminder status|sensor malfunction indicators|sunroof status|interior light status/i.test(lower)) return { value: /status|system|fault|malfunction/i.test(lower) ? 'Normal · sample' : 'Not detected · sample', unit: 'simulated state' };
  if (/fuel type/i.test(lower)) return { value: 'Petrol · sample', unit: 'vehicle-specific' };
  if (/gear position|current gear|gear shift/i.test(lower)) return { value: 'P', unit: 'sample · parked' };
  if (/impact direction|travel direction|vehicle heading/i.test(lower)) return { value: 'North · sample', unit: '° / direction' };
  if (/latitude/i.test(lower)) return { value: '12.9716', unit: '° · simulated' };
  if (/longitude/i.test(lower)) return { value: '77.5946', unit: '° · simulated' };
  if (/timestamp|accident location|parking location|stoppage locations|current route/i.test(lower)) return { value: '—', unit: 'no event · simulated' };
  if (/humidity|air quality|oxygen concentration|oxygen sensor/i.test(lower)) return { value: String(40 + (id % 30)), unit: /concentration|oxygen/i.test(lower) ? '%' : '% RH · sample' };
  if (/temperature/i.test(lower)) return { value: String(24 + (id % 34)), unit: '°C · sample' };
  if (/pressure/i.test(lower)) return { value: String(100 + (id % 24)), unit: 'kPa · sample' };
  if (/voltage/i.test(lower)) return { value: (12 + (id % 28) / 10).toFixed(1), unit: 'V · sample' };
  if (/current/i.test(lower)) return { value: (4 + (id % 90) / 10).toFixed(1), unit: 'A · sample' };
  if (/percentage|position|opening|load|level|state of charge|occupancy|efficiency|health|ratio|air-fuel/i.test(lower)) return { value: String(20 + (id % 70)), unit: '%' };
  if (/speed/i.test(lower)) return { value: '0', unit: 'km/h · parked sample' };
  if (/acceleration|deceleration/i.test(lower)) return { value: '0.0', unit: 'm/s²' };
  if (/distance|range|altitude|depth|height/i.test(lower)) return { value: String(5 + (id % 95)), unit: /altitude|height/i.test(lower) ? 'm · sample' : 'm · sample' };
  if (/torque/i.test(lower)) return { value: String(90 + (id % 110)), unit: 'Nm' };
  if (/power/i.test(lower)) return { value: String(8 + (id % 80)), unit: 'kW' };
  if (/count|frequency|hours|duration|interval|time|cycles/i.test(lower)) return { value: String(id % 9), unit: 'count / sample' };
  if (/consumption|injection rate|flow|mass air flow|airflow/i.test(lower)) return { value: (2.1 + (id % 35) / 10).toFixed(1), unit: 'sample units' };
  if (/angle|timing|curvature|steering/i.test(lower)) return { value: '0', unit: '° · sample' };
  if (/temperature|wear|condition|status|system|performance|activation|detection|recognition|markings|boundary|occupancy/i.test(lower)) return { value: 'Normal · sample', unit: 'simulated state' };
  return { value: 'Available · sample', unit: 'vehicle-dependent' };
}

function hardwareNote(name) {
  if (optionalPattern.test(name)) return 'Optional or model-specific hardware; sample value is synthetic.';
  return 'Availability and encoding vary by make, model, year, ECU, and market; sample value is synthetic.';
}

const text = await readFile(path.resolve(sourcePath), 'utf8');
const categories = [];
let currentCategory = null;
for (const rawLine of text.split(/\r?\n/)) {
  const match = rawLine.trim().match(/^\d+\.\s+(.+)$/);
  if (!match) continue;
  const heading = categoryDefinitions.find(([sourceName]) => sourceName === match[1]);
  if (heading) {
    currentCategory = { id: heading[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name: heading[1], source: sourceByCategory[heading[1]], signals: [] };
    categories.push(currentCategory);
    continue;
  }
  if (!currentCategory) continue;
  const idMatch = rawLine.trim().match(/^(\d+)\.\s+(.+)$/);
  if (!idMatch) continue;
  const id = Number(idMatch[1]);
  const name = idMatch[2].trim();
  const rule = alertRule(name);
  currentCategory.signals.push({
    id,
    name,
    sample: sampleFor(name, id, currentCategory.name),
    source: currentCategory.source,
    availability: hardwareNote(name),
    alertRule: rule,
  });
}

const signals = categories.flatMap((category) => category.signals);
const methods = [
  { name: 'OBD-II', provides: 'Engine, fuel, speed, emissions, diagnostic trouble codes', caveat: 'Vehicle protocol and supported PID coverage vary.' },
  { name: 'GPS / GNSS', provides: 'Location, route, heading, altitude, and some speed estimates', caveat: 'Requires permission and a location receiver; indoor/urban readings can be inaccurate.' },
  { name: 'IMU', provides: 'Acceleration, rotation, sudden impact estimates', caveat: 'A generic IMU alone cannot reliably confirm a crash or occupant injury.' },
  { name: 'TPMS', provides: 'Per-wheel pressure and sometimes temperature', caveat: 'Sensor coverage and thresholds are vehicle-specific; TPMS does not replace regular checks.' },
  { name: 'Camera / driver-monitoring system', provides: 'Lane, obstacle, sign, and driver-attention signals', caveat: 'Needs validated, calibrated hardware and OEM-approved safety logic.' },
  { name: 'Radar / ultrasonic', provides: 'Relative distance, blind spot, and parking proximity', caveat: 'Coverage and alert semantics depend on vehicle hardware and calibration.' },
  { name: 'Additional IoT sensors', provides: 'Cabin air, environment, water depth, and component condition', caveat: 'Only available when the corresponding sensor is installed and calibrated.' },
];

const catalog = {
  title: 'Complete car-sensor catalogue',
  count: signals.length,
  sampleNotice: 'All displayed readings are synthetic examples, not live vehicle data. Values may not describe one physically coherent vehicle. Use vehicle/OEM warnings and specifications for real operation.',
  categories,
  collectionMethods: methods,
};
const outputPath = path.join(root, 'public', 'data', 'sensor-catalog.json');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`Wrote ${signals.length} sensor entries across ${categories.length} categories.`);
