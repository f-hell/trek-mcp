// Standard GraphQL introspection query (trimmed: no descriptions of directives).
export const getIntrospectionQuery = () => /* GraphQL */ `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      types {
        kind name description
        fields(includeDeprecated: true) {
          name description
          args { name type { ...TypeRef } defaultValue }
          type { ...TypeRef }
        }
        inputFields { name type { ...TypeRef } defaultValue }
        enumValues(includeDeprecated: true) { name }
      }
    }
  }
  fragment TypeRef on __Type {
    kind name
    ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
  }
`;
