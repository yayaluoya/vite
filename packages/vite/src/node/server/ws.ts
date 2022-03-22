import colors from 'picocolors'
import type { Server } from 'http'
import { STATUS_CODES } from 'http'
import type { ServerOptions as HttpsServerOptions } from 'https'
import { createServer as createHttpsServer } from 'https'
import type { ServerOptions } from 'ws'
import { WebSocketServer as WebSocket } from 'ws'
import type { WebSocket as WebSocketTypes } from 'types/ws'
import type { ErrorPayload, HMRPayload } from 'types/hmrPayload'
import type { ResolvedConfig } from '..'
import { isObject } from '../utils'
import type { Socket } from 'net'
export const HMR_HEADER = 'vite-hmr'

export interface WebSocketServer {
  /** 监听事件 */
  on: WebSocketTypes.Server['on']
  /** 取消监听事件 */
  off: WebSocketTypes.Server['off']
  /** 发送 */
  send(payload: HMRPayload): void
  /** 关闭 */
  close(): Promise<void>
}

export function createWebSocketServer(
  server: Server | null,
  config: ResolvedConfig,
  httpsOptions?: HttpsServerOptions
): WebSocketServer {
  let wss: WebSocket
  let httpsServer: Server | undefined = undefined

  const hmr = isObject(config.server.hmr) && config.server.hmr
  const wsServer = (hmr && hmr.server) || server

  if (wsServer) {
    wss = new WebSocket({ noServer: true })
    /**
     * 每次客户端请求 HTTP 升级时触发。 监听此事件是可选的，客户端不能坚持协议更改。
      触发此事件后，请求的套接字将没有 'data' 事件监听器，这意味着需要绑定它才能处理发送到该套接字上的服务器的数据。
     */
    wsServer.on('upgrade', (req, socket, head) => {
      if (req.headers['sec-websocket-protocol'] === HMR_HEADER) {
        wss.handleUpgrade(req, socket as Socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      }
    })
  } else {
    const websocketServerOptions: ServerOptions = {}
    const port = (hmr && hmr.port) || 24678
    if (httpsOptions) {
      // if we're serving the middlewares over https, the ws library doesn't support automatically creating an https server, so we need to do it ourselves
      // create an inline https server and mount the websocket server to it
      httpsServer = createHttpsServer(httpsOptions, (req, res) => {
        const statusCode = 426
        const body = STATUS_CODES[statusCode]
        if (!body)
          throw new Error(
            `No body text found for the ${statusCode} status code`
          )

        res.writeHead(statusCode, {
          'Content-Length': body.length,
          'Content-Type': 'text/plain'
        })
        res.end(body)
      })

      httpsServer.listen(port)
      websocketServerOptions.server = httpsServer
    } else {
      // we don't need to serve over https, just let ws handle its own server
      websocketServerOptions.port = port
    }

    // vite dev server in middleware mode中间件模式下的vite开发服务器
    wss = new WebSocket(websocketServerOptions)
  }

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'connected' }))
    if (bufferedError) {
      socket.send(JSON.stringify(bufferedError))
      bufferedError = null
    }
  })

  wss.on('error', (e: Error & { code: string }) => {
    if (e.code !== 'EADDRINUSE') {
      config.logger.error(
        colors.red(`WebSocket server error:\n${e.stack || e.message}`),
        { error: e }
      )
    }
  })

  // On page reloads, if a file fails to compile and returns 500, the server
  // sends the error payload before the client connection is established.
  // If we have no open clients, buffer the error and send it to the next
  // connected client.
  let bufferedError: ErrorPayload | null = null

  return {
    on: wss.on.bind(wss),
    off: wss.off.bind(wss),
    send(payload: HMRPayload) {
      if (payload.type === 'error' && !wss.clients.size) {
        bufferedError = payload
        return
      }

      const stringified = JSON.stringify(payload)
      //所有连接的客户端
      wss.clients.forEach((client) => {
        // readyState 1 means the connection is open
        if (client.readyState === 1) {
          client.send(stringified)
        }
      })
    },

    close() {
      return new Promise((resolve, reject) => {
        wss.clients.forEach((client) => {
          client.terminate()
        })
        wss.close((err) => {
          if (err) {
            reject(err)
          } else {
            if (httpsServer) {
              httpsServer.close((err) => {
                if (err) {
                  reject(err)
                } else {
                  resolve()
                }
              })
            } else {
              resolve()
            }
          }
        })
      })
    }
  }
}
