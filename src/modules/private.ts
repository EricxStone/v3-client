import {
  KeyPair,
  Order as StarkExOrder,
  asEcKeyPair,
  asSimpleKeyPair,
  ApiMethod,
  ApiRequest,
  OrderSide,
  OrderType,
  Asset,
  Withdrawal as StarkExWithdrawal,
  InternalOrder,
} from '@dydxprotocol/starkex-lib';

import { generateQueryPath } from '../helpers/request-helpers';
import {
  RequestMethod,
  axiosRequest,
} from '../lib/axios';
import { getAccountId } from '../lib/db';
import {
  AccountAction,
  AccountResponseObject,
  ApiOrder,
  ApiWithdrawal,
  Data,
  FillResponseObject,
  FundingResponseObject,
  ISO8601,
  Market,
  OrderResponseObject,
  OrderStatus,
  PartialBy,
  PositionResponseObject,
  PositionStatus,
  TransferResponseObject,
  UserResponseObject,
} from '../types';

// TODO: Figure out if we can get rid of this.
const METHOD_ENUM_MAP: Record<RequestMethod, ApiMethod> = {
  [RequestMethod.DELETE]: ApiMethod.DELETE,
  [RequestMethod.GET]: ApiMethod.GET,
  [RequestMethod.POST]: ApiMethod.POST,
  [RequestMethod.PUT]: ApiMethod.PUT,
};

export default class Private {
  readonly host: string;
  readonly apiKeyPair: KeyPair;
  readonly starkKeyPair?: KeyPair;

  constructor(
    host: string,
    apiPrivateKey: string | KeyPair,
    starkPrivateKey?: string | KeyPair,
  ) {
    this.host = host;
    this.apiKeyPair = asSimpleKeyPair(asEcKeyPair(apiPrivateKey));
    if (starkPrivateKey) {
      this.starkKeyPair = asSimpleKeyPair(asEcKeyPair(starkPrivateKey));
    }
  }

  // ============ Request Helpers ============

  protected async request(
    method: RequestMethod,
    endpoint: string,
    data?: {},
  ): Promise<Data> {
    const requestPath = `/v3/${endpoint}`;
    const timestamp: ISO8601 = new Date().toISOString();
    const headers = {
      'DYDX-SIGNATURE': this.sign({
        requestPath,
        method,
        timestamp,
        data,
      }),
      'DYDX-API-KEY': this.apiKeyPair.publicKey,
      'DYDX-TIMESTAMP': timestamp,
    };
    return axiosRequest({
      url: `${this.host}${requestPath}`,
      method,
      data,
      headers,
    });
  }

  protected async get(
    endpoint: string,
    params: {},
  ): Promise<Data> {
    return this.request(RequestMethod.GET, generateQueryPath(endpoint, params));
  }

  protected async post(
    endpoint: string,
    data: {},
  ): Promise<Data> {
    return this.request(RequestMethod.POST, endpoint, data);
  }

  protected async put(
    endpoint: string,
    data: {},
  ): Promise<Data> {
    return this.request(RequestMethod.PUT, endpoint, data);
  }

  protected async delete(
    endpoint: string,
    params: {},
  ): Promise<Data> {
    return this.request(RequestMethod.DELETE, generateQueryPath(endpoint, params));
  }

  // ============ Requests ============

  async getRegistration(): Promise<{ signature: string }> {
    return this.get(
      'registration',
      {},
    );
  }

  async getUser(): Promise<{ user: UserResponseObject }> {
    return this.get(
      'users',
      {},
    );
  }

  async updateUser({
    email,
    username,
    userData,
  }: {
    email: string,
    username: string,
    userData: {},
  }): Promise<{ user: UserResponseObject }> {
    return this.put(
      'users',
      {
        email,
        username,
        userData: JSON.stringify(userData),
      },
    );
  }

  async createAccount(
    starkKey: string,
  ): Promise<{ account: AccountResponseObject }> {
    return this.post(
      'accounts',
      {
        starkKey,
      },
    );
  }

  async getAccount(ethereumAddress: string): Promise<{ account: AccountResponseObject }> {
    return this.get(
      `accounts/${getAccountId({ address: ethereumAddress })}`,
      {},
    );
  }

  async getAccounts(): Promise<{ account: AccountResponseObject[] }> {
    return this.get(
      'accounts',
      {},
    );
  }

  async getPositions(
    params: {
      market?: Market,
      status?: PositionStatus,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    },
  ): Promise<{ positions: PositionResponseObject[] }> {
    return this.get(
      'positions',
      params,
    );
  }

  async getOrders(
    params: {
      market?: Market,
      status?: OrderStatus,
      side?: OrderSide,
      type?: OrderType,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    } = {},
  ): Promise<{ orders: OrderResponseObject[] }> {
    return this.get(
      'orders',
      params,
    );
  }

  async getOrderById(orderId: string): Promise<{ order: OrderResponseObject }> {
    return this.get(
      `orders/${orderId}`,
      {},
    );
  }

  async getOrderByClientId(clientId: string): Promise<{ order: OrderResponseObject }> {
    return this.get(
      `orders/client/${clientId}`,
      {},
    );
  }

  async createOrder(
    params: PartialBy<ApiOrder, 'clientId' | 'signature'>,
    positionId: string,
  ): Promise<{ order: OrderResponseObject }> {
    // TODO: Allow clientId to be a string.
    // const clientId = params.clientId || Math.random().toString(36).slice(2);
    //
    // Have to strip leading zeroes since clientId is being mis-processed as a number.
    const clientId = params.clientId || Math.random().toString().slice(2).replace(/^0+/, '');

    let signature: string | undefined = params.signature;
    if (!signature) {
      if (!this.starkKeyPair) {
        throw new Error('Order is not signed and client was not initialized with starkPrivateKey');
      }
      const orderToSign: InternalOrder = {
        ...params,
        clientId,
        positionId,
        starkKey: this.starkKeyPair.publicKey,
        expiresAt: params.expiration,
      };
      const starkOrder: StarkExOrder = StarkExOrder.fromInternal(orderToSign);
      signature = starkOrder.sign(this.starkKeyPair);
    }

    const order: ApiOrder = {
      ...params,
      clientId,
      signature,
    };

    return this.post(
      'orders',
      order,
    );
  }

  async cancelOrder(orderId: string): Promise<void> {
    return this.delete(
      `orders/${orderId}`,
      {},
    );
  }

  async cancelAllOrders(market?: Market): Promise<void> {
    const params = market ? { market } : {};
    return this.delete(
      'orders',
      params,
    );
  }

  async getFills(
    params: {
      market?: Market,
      orderId?: string,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    },
  ): Promise<{ fills: FillResponseObject[] }> {
    return this.get(
      'fills',
      params,
    );
  }

  async getTransfers(
    params: {
      type?: AccountAction,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    },
  ): Promise<{ transfers: TransferResponseObject[] }> {
    return this.get(
      'transfers',
      params,
    );
  }

  async createWithdrawal(
    params: PartialBy<ApiWithdrawal, 'clientId' | 'signature'>,
    positionId: string,
  ): Promise<{ withdrawal: TransferResponseObject }> {
    // TODO: Allow clientId to be a string.
    // const clientId = params.clientId || Math.random().toString(36).slice(2);
    //
    // Have to strip leading zeroes since clientId is being mis-processed as a number.
    const clientId = params.clientId || Math.random().toString().slice(2).replace(/^0+/, '');

    let signature: string | undefined = params.signature;
    if (!signature) {
      if (!this.starkKeyPair) {
        throw new Error(
          'Withdrawal is not signed and client was not initialized with starkPrivateKey',
        );
      }
      const withdrawalToSign = {
        ...params,
        clientId,
        starkKey: this.starkKeyPair.publicKey,
        debitAmount: params.amount,
        expiresAt: params.expiration,
        positionId,
      };
      const starkWithdrawal: StarkExWithdrawal = StarkExWithdrawal.fromInternal(withdrawalToSign);
      signature = starkWithdrawal.sign(this.starkKeyPair);
    }

    const withdrawal: ApiWithdrawal = {
      ...params,
      clientId,
      signature,
    };

    return this.post(
      'withdrawals',
      withdrawal,
    );
  }

  async createDeposit(
    params: {
      amount: string,
      asset: Asset,
      fromAddress: string,
    },
  ): Promise<{ deposit: TransferResponseObject }> {
    return this.post(
      'deposits',
      params,
    );
  }

  async getFundingPayments(
    params: {
      market?: Market,
      limit?: number,
      effectiveBeforeOrAt?: ISO8601,
    },
  ): Promise<{ fundingPayments: FundingResponseObject }> {
    return this.get(
      'funding',
      params,
    );
  }

  // ============ Request Generation Helpers ============

  private sign({
    requestPath,
    method,
    timestamp,
    data,
  }: {
    requestPath: string,
    method: RequestMethod,
    timestamp: ISO8601,
    data?: {},
  }): string {
    return ApiRequest.fromInternal({
      body: data ? JSON.stringify(data) : '',
      requestPath,
      method: METHOD_ENUM_MAP[method],
      publicKey: this.apiKeyPair.publicKey,
      expiresAt: timestamp,
    }).sign(this.apiKeyPair.privateKey);
  }
}