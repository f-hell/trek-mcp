// GraphQL documents for ut.no, verified against the live schema on 2026-09-30
// (see docs/RECON.md). Query through https://ut.no/api/graphql; the schema can
// be introspected at https://api.ut.no/v1/graphql (`npm run introspect:utno`).
//
// List fields follow nestjs-query conventions:
//   xs(paging: CursorPaging!, filter: XFilter!, sorting: [XSort!]!) -> { totalCount, edges { node } }
// and the *Near fields take { coordinates: [lon, lat], maxDistance: metres }.

export const CABIN_FIELDS = /* GraphQL */ `
  id
  name
  description
  serviceLevel
  dntCabin
  geojson
  elevationCustom
  bedsStaffed
  bedsSelfService
  bedsNoService
  bedsWinter
  bookingEnabled
  bookingOnly
  bookingUrl
  summertimeText
  wintertimeText
  serviceStatus { serviceLevel from to beds openAllYear key }
  serviceStatusToday { serviceLevel beds key }
  areas { id name areaType }
  routeIds
`;

export const FIND_CABINS = /* GraphQL */ `
  query FindCabins($paging: CursorPaging!, $filter: CabinFilter!, $sorting: [CabinSort!]!) {
    cabins(paging: $paging, filter: $filter, sorting: $sorting) {
      totalCount
      edges { node { ${CABIN_FIELDS} } }
    }
  }
`;

export const CABINS_NEAR = /* GraphQL */ `
  query CabinsNear($input: FindNearInput!) {
    cabinsNear(input: $input) {
      distance
      cabin { ${CABIN_FIELDS} }
    }
  }
`;

export const GET_CABIN = /* GraphQL */ `
  query GetCabin($id: Int!) {
    cabin(id: $id) { ${CABIN_FIELDS} }
  }
`;

// geojson (the full line) is left out: encodedPolyline is much smaller and
// gives the end point.
export const TRIP_FIELDS = /* GraphQL */ `
  id
  name
  description
  grading
  distance
  durationDays
  durationHours
  durationMinutes
  elevationGain
  elevationLoss
  season
  direction
  primaryActivityType
  startPointGeojson
  encodedPolyline
  cabinIds
  areas { id name areaType }
`;

export const FIND_TRIPS = /* GraphQL */ `
  query FindTrips($paging: CursorPaging!, $filter: TripFilter!, $sorting: [TripSort!]!) {
    trips(paging: $paging, filter: $filter, sorting: $sorting) {
      totalCount
      edges { node { ${TRIP_FIELDS} } }
    }
  }
`;

export const TRIPS_NEAR = /* GraphQL */ `
  query TripsNear($input: FindNearInput!) {
    tripsNear(input: $input) {
      distance
      trip { ${TRIP_FIELDS} }
    }
  }
`;

export const GET_TRIP = /* GraphQL */ `
  query GetTrip($id: Int!) {
    trip(id: $id) { ${TRIP_FIELDS} }
  }
`;

export const FIND_AREAS = /* GraphQL */ `
  query FindAreas($paging: CursorPaging!, $filter: AreaFilter!, $sorting: [AreaSort!]!) {
    areas(paging: $paging, filter: $filter, sorting: $sorting) {
      totalCount
      edges { node { id name description areaType } }
    }
  }
`;

export const ROUTE_SUMMARY_FIELDS = /* GraphQL */ `
  id
  name
  code
  type
  placeA
  placeB
  placeVia
  distance
  gradingAb
  gradingBa
  durationDaysAb
  durationHoursAb
  durationMinutesAb
  durationDaysBa
  durationHoursBa
  durationMinutesBa
  elevationGainA
  elevationLossA
  elevationGainB
  elevationLossB
  elevationMax
  waymarkWinter
  encodedPolyline
`;

/** Routes near several points in one request (aliased routesNear). */
export const routesNearPoints = (count: number) => /* GraphQL */ `
  query RoutesNearPoints(${Array.from({ length: count }, (_, i) => `$p${i}: FindNearInput!`).join(", ")}) {
    ${Array.from({ length: count }, (_, i) => `p${i}: routesNear(input: $p${i}) { route { ${ROUTE_SUMMARY_FIELDS} } }`).join("\n    ")}
  }
`;

export const ROUTE_FIELDS = /* GraphQL */ `
  id
  name
  code
  type
  placeA
  placeB
  placeVia
  distance
  gradingAb
  gradingBa
  durationDaysAb
  durationHoursAb
  durationMinutesAb
  durationDaysBa
  durationHoursBa
  durationMinutesBa
  elevationGainA
  elevationLossA
  elevationGainB
  elevationLossB
  elevationMax
  notes
  descriptionAb
  descriptionBa
  waymarkWinter
  encodedPolyline
`;

export const GET_ROUTES = /* GraphQL */ `
  query GetRoutes($paging: CursorPaging!, $filter: RouteFilter!, $sorting: [RouteSort!]!) {
    routes(paging: $paging, filter: $filter, sorting: $sorting) {
      edges { node { ${ROUTE_FIELDS} } }
    }
  }
`;

/**
 * Nearest cabins around several points in one request (one aliased
 * cabinsNear per point), used to find the cabin at the far end of a route.
 */
export const cabinsNearPoints = (count: number) => /* GraphQL */ `
  query CabinsNearPoints(${Array.from({ length: count }, (_, i) => `$p${i}: FindNearInput!`).join(", ")}) {
    ${Array.from({ length: count }, (_, i) => `p${i}: cabinsNear(input: $p${i}) { distance cabin { id name serviceLevel dntCabin geojson bookingUrl routeIds } }`).join("\n    ")}
  }
`;

/** DNT's own list of its signature long-distance routes ("SignaTUR"), as trips. */
export const SIGNATURE_ROUTES = /* GraphQL */ `
  query SignatureRoutes($filter: ListFilter!) {
    lists(paging: { first: 1 }, filter: $filter, sorting: []) {
      edges { node { id name listItems { entity { __typename ... on Trip { id } } } } }
    }
  }
`;
