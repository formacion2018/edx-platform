/**
 *  Store data for the current
 */
(function(define) {
    'use strict';

    define([
        'backbone'
    ],
        function(Backbone) {
            return Backbone.Model.extend({
                defaults: {
                    availableSessions: [],
                    entitlementUUID: '',
                    currentSessionId: '',
                    userId: ''
                }
            });
        }
    );
}).call(this, define || RequireJS.define);
