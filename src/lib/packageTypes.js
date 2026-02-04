/**
 * Bid Package Types
 * These represent how subcontractors typically bid work - grouped by trade specialty.
 * This is different from CSI divisions - it reflects real-world bidding patterns.
 */

export const BID_PACKAGE_TYPES = [
  // GC / Self-Performed (manual entry - not typically bid by subs)
  { id: 'general_requirements', name: 'General Requirements', description: 'Supervision, temp facilities, cleanup, permits, insurance (GC self-performed, manual entry)', isManualEntry: true },

  // Site & Structure
  { id: 'demolition', name: 'Demolition', description: 'Selective demo, structural demo, hazmat, concrete removal, site clearing' },
  { id: 'sitework', name: 'Sitework', description: 'Excavation, grading, utilities, erosion control, dewatering' },
  { id: 'landscaping', name: 'Landscaping', description: 'Planting, irrigation, sod, mulch' },
  { id: 'paving', name: 'Paving', description: 'Asphalt, concrete paving, striping, curbs' },
  { id: 'concrete', name: 'Concrete', description: 'Foundations, slabs, tilt-up, site concrete, rebar' },
  { id: 'masonry', name: 'Masonry', description: 'CMU, brick, stone veneer' },
  { id: 'structural_steel', name: 'Structural Steel', description: 'Steel, metal deck, misc metals, stairs, railings' },

  // Building Envelope
  { id: 'roofing', name: 'Roofing', description: 'Membrane, roof insulation, flashings, sheet metal, gutters' },
  { id: 'waterproofing', name: 'Waterproofing', description: 'Below-grade waterproofing, air/vapor barriers, sealants' },
  { id: 'metal_panels', name: 'Metal Panels', description: 'ACM, metal wall panels, insulated panels, metal siding' },
  { id: 'glazing', name: 'Glazing', description: 'Windows, storefronts, curtain wall, skylights' },

  // Interiors
  { id: 'drywall_acoustical', name: 'Drywall/Acoustical', description: 'Metal studs, drywall, wall insulation, ACT ceilings, acoustical, firestopping' },
  { id: 'doors_hardware', name: 'Doors/Hardware', description: 'Doors, frames, hardware, access doors' },
  { id: 'millwork', name: 'Millwork/Casework', description: 'Custom cabinets, built-ins, countertops, architectural woodwork' },
  { id: 'painting', name: 'Painting', description: 'Paint, stain, wall coverings, coatings' },
  { id: 'flooring', name: 'Flooring', description: 'Carpet, VCT, LVT, rubber, tile, wood, epoxy, base' },
  { id: 'window_treatments', name: 'Window Treatments', description: 'Blinds, shades, curtains, interior sun control' },

  // Specialties (separate packages for specific items)
  { id: 'signage', name: 'Signage', description: 'Interior signage, exterior signage, wayfinding, ADA signs, room signs' },
  { id: 'bathroom_accessories', name: 'Bathroom Accessories/Partitions', description: 'Toilet partitions, grab bars, mirrors, dispensers, bathroom accessories' },
  { id: 'fire_extinguishers', name: 'Fire Extinguishers/Cabinets', description: 'Fire extinguishers, fire extinguisher cabinets, mounting brackets' },
  { id: 'specialties', name: 'Specialties', description: 'Lockers, corner guards, wall protection, misc specialties' },

  // Equipment
  { id: 'laboratory', name: 'Laboratory Casework/Equipment', description: 'Lab casework, fume hoods, lab benches, lab equipment, lab fixtures' },
  { id: 'equipment', name: 'Equipment', description: 'Appliances, kitchen equipment, food service, laundry' },
  { id: 'conveying', name: 'Conveying', description: 'Elevators, lifts, escalators, dumbwaiters' },

  // MEP
  { id: 'plumbing', name: 'Plumbing', description: 'Fixtures, piping, water heaters, gas' },
  { id: 'hvac', name: 'HVAC', description: 'Equipment, ductwork, controls, TAB' },
  { id: 'electrical', name: 'Electrical', description: 'Power, wiring, lighting, panels (NOT low voltage or fire alarm)' },
  { id: 'low_voltage', name: 'Low Voltage', description: 'Data/voice cabling, AV, security rough-in (separate from electrical)' },
  { id: 'fire_alarm', name: 'Fire Alarm', description: 'Alarm panels, detectors, notification devices (separate from electrical & sprinklers)' },
  { id: 'fire_protection', name: 'Fire Protection', description: 'Sprinklers, standpipes, fire pump (separate from fire alarm)' },
]

// Helper to get package type by ID
export function getPackageType(id) {
  return BID_PACKAGE_TYPES.find(p => p.id === id)
}

// Helper to get package names from IDs
export function getPackageNames(ids) {
  return ids.map(id => getPackageType(id)?.name).filter(Boolean)
}

// Helper to check if a package type is manual entry (not bid by subs)
export function isManualEntryPackage(id) {
  return getPackageType(id)?.isManualEntry === true
}
