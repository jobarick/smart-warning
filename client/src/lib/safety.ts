import type { AlertType } from '../types';
import type { IconName } from '../components/Icon';

/**
 * The safety library — what to do before, during and after an emergency.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ⚠️  THIS CONTENT HAS NOT BEEN REVIEWED BY A QUALIFIED PROFESSIONAL.
 *
 *  It is drafted from widely published public guidance (Red Cross, WHO and
 *  national disaster-management advice) and written to be short enough to act
 *  on. It must be reviewed by emergency officers, medical, fire and rescue
 *  professionals before this app is used to guide anybody in a real incident.
 *  See docs/IMPROVEMENT_PLAN.md, the consultation pack.
 *
 *  Wrong safety advice is worse than none, and this file is the one place in
 *  the product where that is true.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Bundled rather than fetched, deliberately. The moment somebody needs this is
 * the moment the network is least likely to cooperate, so it ships with the
 * app and works with the radio off — the same reasoning as the emergency
 * numbers in server/emergency-numbers.js.
 *
 * Three phases because that is the structure every national preparedness
 * programme uses, and because it answers different questions at different
 * times: before is preparation, during is survival, after is recovery.
 *
 * `alertType` is the canonical wire type this category maps to. There are more
 * categories here than there are wire types, on purpose — see Part III of the
 * improvement plan. It lets guidance sit beside the alert it belongs to without
 * inventing protocol values that older devices cannot understand.
 */

export type SafetyGroup = 'personal' | 'natural' | 'infrastructure' | 'health';

export interface SafetyGuide {
  id: string;
  title: string;
  group: SafetyGroup;
  icon: IconName;
  /** One line, shown in the list. Says what the guide is for, not what it is. */
  summary: string;
  alertType: AlertType;
  before: string[];
  during: string[];
  after: string[];
}

export const SAFETY_GROUPS: { id: SafetyGroup; label: string }[] = [
  { id: 'personal', label: 'Personal & everyday' },
  { id: 'natural', label: 'Natural hazards' },
  { id: 'infrastructure', label: 'Buildings, work & utilities' },
  { id: 'health', label: 'Public health' },
];

export const SAFETY_GUIDES: SafetyGuide[] = [
  // --- Personal & everyday -------------------------------------------------
  {
    id: 'medical',
    title: 'Medical emergency',
    group: 'personal',
    icon: 'medical',
    summary: 'Someone is injured, collapsed or seriously unwell.',
    alertType: 'medical',
    before: [
      'Learn where the nearest first-aid kit and trained first-aider are.',
      'Save your local ambulance number in your phone.',
      'Keep any personal medical information somewhere a helper can find it.',
    ],
    during: [
      'Check the area is safe before you approach.',
      'Call for help and send someone specific to guide it in.',
      'Do not move the person unless they are in immediate danger.',
      'If they are unresponsive and not breathing normally, start chest compressions if you are trained.',
      'Stay with them and keep them warm and still.',
    ],
    after: [
      'Hand over what you saw and what you did to the responders.',
      'Report the incident so it is on record.',
      'Replace anything you used from the first-aid kit.',
    ],
  },
  {
    id: 'road-accident',
    title: 'Road accident',
    group: 'personal',
    icon: 'hazard',
    summary: 'A crash involving vehicles, riders or pedestrians.',
    alertType: 'medical',
    before: [
      'Wear a seatbelt or helmet on every journey, however short.',
      'Keep a warning triangle and a torch in the vehicle.',
      'Know the road-rescue and ambulance numbers for your area.',
    ],
    during: [
      'Stop safely and switch on hazard lights.',
      'Do not stand in the traffic lane; warn oncoming vehicles from a safe distance.',
      'Switch off engines and do not smoke — fuel may be leaking.',
      'Leave anyone with a possible neck or back injury where they are unless there is fire or flooding.',
      'Call for medical help and give the road name or nearest landmark.',
    ],
    after: [
      'Record what happened while it is fresh, including the time and location.',
      'Exchange details with those involved.',
      'Get checked medically even if you feel unhurt.',
    ],
  },
  {
    id: 'security',
    title: 'Personal security threat',
    group: 'personal',
    icon: 'lock',
    summary: 'You are being followed, threatened or feel unsafe.',
    alertType: 'security',
    before: [
      'Tell someone your route and expected arrival when travelling alone.',
      'Keep your phone charged and reachable without opening a bag.',
      'Agree a word with family that means "I need help" without saying so.',
    ],
    during: [
      'Move towards people, light and open businesses.',
      'Do not fight for property — possessions can be replaced.',
      'Raise an alert so your location is shared.',
      'If you cannot get away, make yourself noticeable: shout, sound an alarm.',
    ],
    after: [
      'Get somewhere safe before you do anything else.',
      'Report to the police as soon as you can.',
      'Write down descriptions and details while you still remember them.',
    ],
  },
  {
    id: 'violence',
    title: 'Violence or attack',
    group: 'personal',
    icon: 'shield-alert',
    summary: 'An armed or violent incident where you are.',
    alertType: 'security',
    before: [
      'Notice the exits in any building you spend time in.',
      'Agree with your team where you would gather if you had to leave quickly.',
    ],
    during: [
      'Get out if there is a safe route, and leave belongings behind.',
      'If you cannot get out, lock or barricade the door and stay out of sight.',
      'Silence your phone but keep it with you.',
      'Stay quiet and wait for an official all-clear, not a rumour.',
    ],
    after: [
      'Follow the instructions of the responders exactly, including how to exit.',
      'Report yourself safe so nobody is searching for you.',
      'Ask for support — reactions to this often arrive days later.',
    ],
  },
  {
    id: 'missing-person',
    title: 'Missing person',
    group: 'personal',
    icon: 'user',
    summary: 'Someone cannot be found and it is out of character.',
    alertType: 'security',
    before: [
      'Keep a recent photograph of children and vulnerable family members.',
      'Agree a meeting point for when a group is separated.',
    ],
    during: [
      'Search the immediate area first, including water, vehicles and enclosed spaces.',
      'Report to the police straight away — do not wait a fixed number of hours.',
      'Give a description, what they were wearing, and where they were last seen.',
      'Keep one phone free for callbacks.',
    ],
    after: [
      'Tell everyone who was searching that the person has been found.',
      'Record what happened, so the same gap does not recur.',
    ],
  },
  {
    id: 'water',
    title: 'Drowning & water emergency',
    group: 'personal',
    icon: 'hazard',
    summary: 'Someone is in difficulty in water.',
    alertType: 'medical',
    before: [
      'Learn to swim, and teach children early.',
      'Never swim alone or in unfamiliar water.',
      'Wear a life jacket on boats regardless of how well you swim.',
    ],
    during: [
      'Do not enter the water yourself unless you are trained — most would-be rescuers drown.',
      'Reach or throw: hold out a pole or branch, or throw something that floats.',
      'Shout for help and send someone for a lifeguard or rescue service.',
      'Once out, if they are not breathing normally, start rescue breaths and compressions if trained.',
    ],
    after: [
      'Get medical help even if they seem recovered — water in the lungs can cause harm hours later.',
      'Keep them warm and lying on their side.',
    ],
  },

  // --- Natural hazards -----------------------------------------------------
  {
    id: 'flood',
    title: 'Flood & flash flood',
    group: 'natural',
    icon: 'hazard',
    summary: 'Rising water, or water moving fast across roads and ground.',
    alertType: 'hazard',
    before: [
      'Know whether where you live, work or travel is low-lying.',
      'Keep documents and a torch somewhere high and dry.',
      'Agree where your household would go if you had to leave.',
    ],
    during: [
      'Move to higher ground immediately — do not wait to see how high it gets.',
      'Never walk, drive or ride through moving water. Ankle-deep water can take you off your feet, and knee-deep water can move a car.',
      'Stay away from drains, culverts and riverbanks.',
      'Switch off electricity at the mains if water is entering the building and it is safe to reach.',
    ],
    after: [
      'Do not return until you are told the water has gone down.',
      'Assume floodwater is contaminated: wash hands, and do not drink tap water until it is declared safe.',
      'Do not switch on electrics that have been wet until they are checked.',
    ],
  },
  {
    id: 'earthquake',
    title: 'Earthquake',
    group: 'natural',
    icon: 'hazard',
    summary: 'Ground shaking, and the aftershocks that follow.',
    alertType: 'hazard',
    before: [
      'Secure tall furniture and heavy objects to walls.',
      'Know a clear spot in each room away from windows and anything that can fall.',
      'Keep shoes and a torch beside the bed.',
    ],
    during: [
      'Drop, cover and hold on. Get under a sturdy table if there is one.',
      'Stay where you are — most injuries happen to people moving during the shaking.',
      'If outside, move into the open, away from buildings, walls and power lines.',
      'If in a vehicle, stop clear of bridges and overpasses and stay inside.',
    ],
    after: [
      'Expect aftershocks and be ready to take cover again.',
      'Check yourself, then others, for injuries.',
      'Leave a damaged building carefully and do not re-enter it.',
      'Do not light a flame until you are sure there is no gas leak.',
    ],
  },
  {
    id: 'storm',
    title: 'Storm & cyclone',
    group: 'natural',
    icon: 'hazard',
    summary: 'Severe wind and rain, including cyclones and tornadoes.',
    alertType: 'hazard',
    before: [
      'Follow official forecasts when a storm is named or a warning is issued.',
      'Secure or bring in anything outside that can be lifted by wind.',
      'Charge phones and torches while you still have power.',
    ],
    during: [
      'Stay inside, in the smallest interior room, away from windows.',
      'Do not go outside during a lull — it may be the eye of the storm.',
      'Keep away from anything that could fall: trees, poles, loose roofing.',
    ],
    after: [
      'Wait for an official all-clear before going out.',
      'Treat every fallen cable as live.',
      'Watch for flooding, which often arrives after the wind has passed.',
    ],
  },
  {
    id: 'lightning',
    title: 'Lightning',
    group: 'natural',
    icon: 'hazard',
    summary: 'Electrical storms, and how to avoid being the tallest thing around.',
    alertType: 'hazard',
    before: [
      'If you can hear thunder, you are close enough to be struck.',
      'Plan where you would shelter during outdoor work.',
    ],
    during: [
      'Go inside a building or a hard-topped vehicle.',
      'Get off high ground and away from water, trees and metal.',
      'Do not shelter under an isolated tree.',
      'If caught in the open with no shelter, crouch low on the balls of your feet, and do not lie flat.',
    ],
    after: [
      'Wait 30 minutes after the last thunder before going back out.',
      'Someone struck by lightning carries no charge — it is safe to help them immediately.',
    ],
  },
  {
    id: 'heat',
    title: 'Extreme heat',
    group: 'natural',
    icon: 'flame',
    summary: 'Dangerously hot conditions, indoors or outside.',
    alertType: 'hazard',
    before: [
      'Check the forecast and plan hard work for early morning.',
      'Know who nearby is most at risk: older people, small children, anyone working outdoors.',
    ],
    during: [
      'Drink water regularly, before you feel thirsty.',
      'Stay in shade or the coolest room, especially between late morning and mid-afternoon.',
      'Never leave anyone, or an animal, in a parked vehicle.',
      'Watch for heat exhaustion: heavy sweating, dizziness, cramps, nausea.',
    ],
    after: [
      'If someone stops sweating, becomes confused or collapses, treat it as a medical emergency and cool them immediately.',
      'Keep checking on people who live alone.',
    ],
  },
  {
    id: 'wildfire',
    title: 'Wildfire & bush fire',
    group: 'natural',
    icon: 'flame',
    summary: 'Fire spreading through bush, grass or forest.',
    alertType: 'fire',
    before: [
      'Clear dry vegetation from around buildings.',
      'Know two ways out of your area, in case one is cut off.',
    ],
    during: [
      'Leave early. Waiting to see is what makes escape routes impassable.',
      'Drive with headlights on and windows closed.',
      'If you cannot get out, move to open cleared ground away from vegetation.',
      'Cover your mouth and nose; smoke harms before flame reaches you.',
    ],
    after: [
      'Do not return until the area is declared safe — ground can stay hot for days.',
      'Watch for falling trees and weakened structures.',
    ],
  },
  {
    id: 'landslide',
    title: 'Landslide',
    group: 'natural',
    icon: 'hazard',
    summary: 'Ground giving way, usually after heavy rain.',
    alertType: 'hazard',
    before: [
      'Be aware if you are below a steep slope, especially after long rain.',
      'Notice new cracks in ground, walls or roads.',
    ],
    during: [
      'Move out of the path of the slide, sideways rather than downhill.',
      'If indoors and you cannot leave, get to an upper floor away from the slope.',
      'Listen for unusual sounds: cracking trees, boulders knocking together.',
    ],
    after: [
      'Stay away — further slides often follow.',
      'Report blocked roads and broken utility lines.',
    ],
  },
  {
    id: 'tsunami',
    title: 'Tsunami',
    group: 'natural',
    icon: 'hazard',
    summary: 'Sea surge following an offshore earthquake. Coastal areas only.',
    alertType: 'evacuation',
    before: [
      'If you live or work on the coast, know your nearest high ground and how long it takes to reach on foot.',
    ],
    during: [
      'Strong shaking near the coast is itself the warning. Do not wait for an official message.',
      'If the sea suddenly draws back, move inland and uphill immediately.',
      'Go on foot if you can — roads jam.',
      'Keep going: the first wave is often not the largest.',
    ],
    after: [
      'Stay on high ground until officials say the sequence has ended.',
      'Do not go to the shore to look.',
    ],
  },

  // --- Buildings, work & utilities -----------------------------------------
  {
    id: 'fire',
    title: 'Building fire',
    group: 'infrastructure',
    icon: 'flame',
    summary: 'Fire or smoke inside a building.',
    alertType: 'fire',
    before: [
      'Know two ways out of every floor you use.',
      'Test smoke alarms and know where extinguishers are.',
      'Agree where your household or team gathers outside.',
    ],
    during: [
      'Raise the alarm and get out. Do not collect belongings.',
      'Stay low — smoke kills more people than flame.',
      'Feel a door before opening it; if it is hot, use the other route.',
      'Never use a lift.',
      'Close doors behind you to slow the fire.',
    ],
    after: [
      'Go to the assembly point and report yourself there, so nobody searches for you.',
      'Do not go back in for anything.',
      'Tell the fire service if you believe anyone is still inside.',
    ],
  },
  {
    id: 'collapse',
    title: 'Structural collapse',
    group: 'infrastructure',
    icon: 'hazard',
    summary: 'A building or structure has failed, or is about to.',
    alertType: 'hazard',
    before: [
      'Report new cracks, sagging floors or leaning walls immediately.',
      'Do not allow heavy loads onto floors not designed for them.',
    ],
    during: [
      'Get out if there is a clear route; move away from the structure.',
      'If trapped, cover your mouth and nose against dust.',
      'Tap on pipes or a wall in a regular rhythm rather than shouting — it carries further and costs less air.',
      'Avoid moving debris above you.',
    ],
    after: [
      'Keep everyone clear — collapses continue.',
      'Tell rescuers where people were last seen.',
    ],
  },
  {
    id: 'electrical',
    title: 'Electrical emergency',
    group: 'infrastructure',
    icon: 'hazard',
    summary: 'Shock, sparking equipment or a downed power line.',
    alertType: 'hazard',
    before: [
      'Keep water away from electrical equipment.',
      'Have faulty wiring repaired rather than worked around.',
    ],
    during: [
      'Do not touch someone who is in contact with electricity.',
      'Switch off the supply at the mains or breaker first.',
      'Treat every fallen cable as live, and keep everyone at least 10 metres away.',
      'Use only a dry non-conductive object to move a cable if there is no alternative.',
    ],
    after: [
      'Get anyone who received a shock checked medically, even if they seem fine.',
      'Do not use affected equipment until it has been inspected.',
    ],
  },
  {
    id: 'gas',
    title: 'Gas leak',
    group: 'infrastructure',
    icon: 'hazard',
    summary: 'A smell of gas, or a hissing from a cylinder or pipe.',
    alertType: 'hazard',
    before: [
      'Have cylinders and connections checked regularly.',
      'Store cylinders upright, outside or in a ventilated space.',
    ],
    during: [
      'Do not use switches, phones or anything that can spark — including turning lights off.',
      'Open doors and windows on your way out.',
      'Turn off the supply at the cylinder or meter if you can reach it safely.',
      'Get everyone out and call for help from a distance.',
    ],
    after: [
      'Do not go back in until it has been checked and cleared.',
      'Have the appliance or fitting repaired before it is used again.',
    ],
  },
  {
    id: 'chemical',
    title: 'Chemical spill or release',
    group: 'infrastructure',
    icon: 'flask',
    summary: 'A hazardous substance has escaped.',
    alertType: 'hazard',
    before: [
      'Know which substances are stored where you work, and what they do.',
      'Know where the eyewash and safety shower are.',
    ],
    during: [
      'Stop work and warn everyone nearby.',
      'Move upwind and uphill of the release.',
      'Do not walk through the spill or try to identify it by smell.',
      'If it is on skin or in eyes, flush with water for at least 15 minutes.',
      'Report exactly what was released and roughly how much.',
    ],
    after: [
      'Stay out of the area until it has been cleared by someone competent.',
      'Keep contaminated clothing away from other people.',
      'Seek medical advice and take the substance name with you.',
    ],
  },
  {
    id: 'industrial',
    title: 'Industrial accident',
    group: 'infrastructure',
    icon: 'hazard',
    summary: 'Machinery, height, or plant failure at a workplace.',
    alertType: 'hazard',
    before: [
      'Follow lock-out procedures before working on machinery.',
      'Wear the protective equipment for the task, not the one nearest to hand.',
    ],
    during: [
      'Make the area safe before approaching — isolate power or moving parts.',
      'Do not move a casualty unless leaving them is more dangerous.',
      'Send for the site first-aider and for emergency services.',
      'Preserve the scene as far as safety allows.',
    ],
    after: [
      'Report it, however minor it looked.',
      'Do not restart equipment until it has been inspected.',
    ],
  },
  {
    id: 'evacuation',
    title: 'Evacuation',
    group: 'infrastructure',
    icon: 'exit',
    summary: 'Leaving a building or area in an organised way.',
    alertType: 'evacuation',
    before: [
      'Know your assembly point and the route to it.',
      'Know who needs help to move, and who is responsible for helping them.',
      'Keep exit routes clear.',
    ],
    during: [
      'Go immediately. Do not stop for belongings.',
      'Use stairs, never a lift.',
      'Help those who need it if you can do so safely.',
      'Go to the assembly point and stay there.',
    ],
    after: [
      'Report yourself safe so the roll call is accurate.',
      'Do not go back for any reason until told it is clear.',
      'Tell the coordinator about anyone you know is unaccounted for.',
    ],
  },

  // --- Public health -------------------------------------------------------
  {
    id: 'outbreak',
    title: 'Disease outbreak',
    group: 'health',
    icon: 'medical',
    summary: 'A contagious illness spreading in your area or workplace.',
    alertType: 'medical',
    before: [
      'Keep vaccinations current where they are offered.',
      'Wash hands properly and often.',
      'Know where your nearest clinic is.',
    ],
    during: [
      'Follow official public health instructions rather than messages forwarded to you.',
      'Stay home if you have symptoms, and tell your workplace.',
      'Cover coughs and sneezes; wash hands after.',
      'Keep drinking safe water, and treat or boil it if advised.',
    ],
    after: [
      'Complete any course of treatment even once you feel better.',
      'Clean shared surfaces and equipment.',
    ],
  },
];

export function guidesInGroup(group: SafetyGroup): SafetyGuide[] {
  return SAFETY_GUIDES.filter((g) => g.group === group);
}

export function findGuide(id: string): SafetyGuide | undefined {
  return SAFETY_GUIDES.find((g) => g.id === id);
}

/** Guidance for a live alert, so a running incident can point at its own page. */
export function guidesForAlert(type: AlertType): SafetyGuide[] {
  return SAFETY_GUIDES.filter((g) => g.alertType === type);
}
