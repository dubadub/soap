/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */
 
function findKey(obj, val) {
    for (var n in obj) if (obj[n] === val) return n;
}

var http = require('./http'),
    assert = require('assert'),
    url = require('url');

var Client = function(wsdl, endpoint) {
    this.wsdl = wsdl;
    this._initializeServices(endpoint);
}

Client.prototype.addSoapHeader = function(soapHeader, name, namespace, xmlns) {
	if(!this.soapHeaders){
		this.soapHeaders = [];
	}
	if(typeof soapHeader == 'object'){
		soapHeader = this.wsdl.objectToXML(soapHeader, name, namespace, xmlns);
	}
	this.soapHeaders.push(soapHeader);
}

Client.prototype.setEndpoint = function(endpoint) {
    this.endpoint = endpoint;
    this._initializeServices(endpoint);
}

Client.prototype.describe = function() {
    var types = this.wsdl.definitions.types;
    return this.wsdl.describeServices();
}

Client.prototype.setSecurity = function(security) {
    this.security = security;
}

Client.prototype.setSOAPAction = function(SOAPAction) {
    this.SOAPAction = SOAPAction;
}

Client.prototype._initializeServices = function(endpoint) {
    var definitions = this.wsdl.definitions,
        services = definitions.services;
    for (var name in services) {
        //console.log(name);
        this[name] = this._defineService(services[name], endpoint);
    }
}

Client.prototype._defineService = function(service, endpoint) {
    var ports = service.ports,
        def = {};
    for (var name in ports) {
        //console.log(ports[name].location);
        def[name] = this._definePort(ports[name], endpoint ? endpoint : ports[name].location);
    }
    //console.log(def);
    return def;
}

Client.prototype._definePort = function(port, endpoint) {
    var location = endpoint,
        binding = port.binding,
        methods = binding.methods,
        def = {};
    for (var name in methods) {
        def[name] = this._defineMethod(methods[name], location);
        if (!this[name]) this[name] = def[name];
    }
    return def;
}

Client.prototype._defineMethod = function(method, location) {
    var self = this;
    return function(args, callback) {
        if (typeof args === 'function') {
            callback = args;
            args = {};
        }
        self._invoke(method, args, location, function(error, result, raw) {
            callback(error, result, raw);
        })
    }
}

Client.prototype._invoke = function(method, arguments, location, callback) {
    var self = this,
        name = method.$name,
        input = method.input,
        output = method.output,
        style = method.style,
        defs = this.wsdl.definitions,
        ns = defs.$targetNamespace,
        encoding = '',
        message = '',
        xml = null,
        soapAction = this.SOAPAction ? this.SOAPAction(ns, name) : (method.soapAction || (((ns.lastIndexOf("/") != ns.length - 1) ? ns + "/" : ns) + name)),
        headers = {
            SOAPAction: '"' + soapAction + '"',
            'Content-Type': "text/xml; charset=utf-8"
        },
        options = {},
        alias = findKey(defs.xmlns, ns);
    //console.log(soapAction);
    // Allow the security object to add headers
    if (self.security && self.security.addHeaders)
        self.security.addHeaders(headers);
    if (self.security && self.security.addOptions)
        self.security.addOptions(options);
        
    if (input.parts) {
        assert.ok(!style || style == 'rpc', 'invalid message definition for document style binding');
        message = self.wsdl.objectToRpcXML(name, arguments, alias, ns);
        (method.inputSoap === 'encoded') && (encoding = 'soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" ');
    }
    else if (typeof(arguments) === 'string') {
      message = arguments;
    }
    else {
        assert.ok(!style || style == 'document', 'invalid message definition for rpc style binding');
        message = self.wsdl.objectToDocumentXML(input.$name, arguments, input.targetNSAlias, input.targetNamespace);
    }
    xml = "<soap:Envelope " + 
            "xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
            encoding +
            this.wsdl.xmlnsInEnvelope + '>' +
            "<soap:Header>" +
                (self.soapHeaders ? self.soapHeaders.join("\n") : "") +
                (self.security ? self.security.toXML() : "") +
            "</soap:Header>" +
            "<soap:Body>" +
                message +
            "</soap:Body>" +
        "</soap:Envelope>";
    
	self.lastRequest = xml;
        console.log("-----------client--------------");
    http.request(location, xml, function(err, response, body) {
        if (err) {
            callback(err);
        }
        else {
            try {
                var obj = self.wsdl.xmlToObject(body);
            }
            catch (error) {
                return callback(error, response, body);
            }
            var result = obj.Body[output.$name];
            // RPC/literal response body may contain element named after the method + 'Response'
            // This doesn't necessarily equal the ouput message name. See WSDL 1.1 Section 2.4.5
            if(!result) {
               result = obj.Body[name + 'Response'];
            }
            callback(null, result, body);
        }
    }, headers, options);
}

exports.Client = Client;
