import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { brandProductName } from '@documenso/lib/constants/brand';
import { generateOpenApi } from '@ts-rest/open-api';
import { ApiContractV1 } from './contract';

export const OpenAPIV1 = Object.assign(
  generateOpenApi(
    ApiContractV1,
    {
      info: {
        title: `${brandProductName()} API`,
        version: '1.0.0',
        description: `The ${brandProductName()} API for retrieving, creating, updating and deleting documents. API v1 is deprecated; use API v2.`,
      },
      servers: [
        {
          url: NEXT_PUBLIC_WEBAPP_URL(),
        },
      ],
    },
    {
      setOperationId: true,
    },
  ),
  {
    components: {
      securitySchemes: {
        authorization: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
        },
      },
    },
    security: [
      {
        authorization: [],
      },
    ],
  },
);
