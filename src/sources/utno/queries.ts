// GraphQL documents for ut.no.
//
// UNVERIFIED. These are placeholders written without access to the live API.
// ut.no's frontend talks to a GraphQL API; replace these with the operations
// and field names captured by `npm run recon -- https://ut.no/...` or, if
// introspection is enabled, by `npm run introspect:utno` (writes
// recon/utno-schema.json).
//
// Keep the result shapes flowing through normalize.ts so that fixing a field
// name here is the only change needed.

export const CABIN_FIELDS = /* GraphQL */ `
  id
  name
  description
  serviceLevel
  dntCabin
  bedsToday
  bedsStaffed
  bedsSelfService
  bedsNoService
  bedsWinter
  geometry
  elevation
  areas { id name }
  bookingEnabled
  bookingUrl
`;

export const FIND_CABINS = /* GraphQL */ `
  query FindCabins($input: NTB_FindCabinsInput) {
    ntb_findCabins(input: $input) {
      totalCount
      edges { node { ${CABIN_FIELDS} } }
    }
  }
`;

export const GET_CABIN = /* GraphQL */ `
  query GetCabin($id: Int!) {
    ntb_getCabin(id: $id) { ${CABIN_FIELDS} }
  }
`;

export const TRIP_FIELDS = /* GraphQL */ `
  id
  name
  description
  grading
  distance
  durationMinutes
  elevationGain
  elevationLoss
  startPoint
  endPoint
  areas { id name }
  cabins { id }
`;

export const FIND_TRIPS = /* GraphQL */ `
  query FindTrips($input: NTB_FindTripsInput) {
    ntb_findTrips(input: $input) {
      totalCount
      edges { node { ${TRIP_FIELDS} } }
    }
  }
`;

export const GET_TRIP = /* GraphQL */ `
  query GetTrip($id: Int!) {
    ntb_getTrip(id: $id) { ${TRIP_FIELDS} }
  }
`;

export const FIND_AREAS = /* GraphQL */ `
  query FindAreas($input: NTB_FindAreasInput) {
    ntb_findAreas(input: $input) {
      totalCount
      edges { node { id name description } }
    }
  }
`;
