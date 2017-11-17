(function(define) {
    'use strict';

    define(['backbone',
        'jquery',
        'underscore',
        'gettext',
        'moment',
        'edx-ui-toolkit/js/utils/html-utils',
        'js/learner_dashboard/models/course_entitlement_model',
        'js/learner_dashboard/models/course_card_model',
        'text!../../../templates/learner_dashboard/course_entitlement.underscore'
    ],
         function(
             Backbone,
             $,
             _,
             gettext,
             moment,
             HtmlUtils,
             EntitlementModel,
             CourseCardModel,
             pageTpl
         ) {
             return Backbone.View.extend({
                 tpl: HtmlUtils.template(pageTpl),

                 events: {
                     'change .session-select': 'updateEnrollBtn',
                     'click .enroll-btn': 'handleEnrollChange',
                     'click .popover-dismiss': 'hideVerificationDialog',
                     'keydown .final-confirmation-btn': 'handleVerificationPopoverA11y'
                 },

                 initialize: function(options) {
                     this.$el = options.$el;

                     // Set up models and reload view on change
                     this.courseCardModel = new CourseCardModel();
                     this.entitlementModel = new EntitlementModel({
                         availableSessions: this.formatDates(JSON.parse(options.availableSessions)),
                         entitlementUUID: options.entitlementUUID,
                         currentSessionId: options.currentSessionId,
                         userId: options.userId
                     });
                     this.listenTo(this.entitlementModel, 'change', this.render);

                     // Grab URLs that handle changing of enrollment and entering a newly enrolled session.
                     this.enrollUrl = options.enrollUrl;
                     this.courseHomeUrl = options.courseHomeUrl;

                     // Grab elements from the parent card that work with this view and bind associated events
                     this.$triggerOpenBtn = options.$triggerOpenBtn || $(''); // Opens and closes session selection view
                     this.$dateDisplayField = options.$dateDisplayField || $(''); // Displays current session dates
                     this.$enterCourseBtn = options.$enterCourseBtn || $(''); // Button link to course home page
                     this.$courseCardMessages = options.$courseCardMessages || $(''); // Additional session messages
                     this.$courseTitleLink = options.$courseTitleLink || $(''); // Title link to course home page
                     this.$courseImageLink = options.$courseImageLink || $(''); // Image link to course home page
                     this.$courseMessages = options.$courseMessages || $(''); // Extra messages attached to course Card
                     this.$triggerOpenBtn.on('click', this.toggleSessionSelectionPanel.bind(this));

                     this.render(options);
                 },

                 render: function() {
                     HtmlUtils.setHtml(this.$el, this.tpl(this.entitlementModel.toJSON()));
                     this.delegateEvents();
                     this.updateEnrollBtn();
                 },

                 toggleSessionSelectionPanel: function() {
                     /*
                     Opens and closes the session selection panel.
                     */
                     this.$el.toggleClass('hidden');
                     if (!this.$el.hasClass('hidden')) {
                         // Set focus to the session selection for a11y purposes
                         this.$('.session-select').focus();
                         this.$('.enroll-btn-initial').popover('hide');
                     }
                     this.updateEnrollBtn();
                 },

                 handleEnrollChange: function() {
                     /*
                     Handles enrolling in a course, unenrolling in a session and changing session.
                     The new session id is stored as a data attribute on the option in the session-select element.
                     */
                     var isUnenrolling;

                     // Grab the id for the desired session, an unenrollment event will return null
                     this.currentSessionSelection = this.$('.session-select')
                         .find('option:selected').data('session_id');
                     isUnenrolling = !this.currentSessionSelection;

                     // Do not allow for enrollment when button is disabled
                     if (this.$('.enroll-btn-initial').hasClass('disabled')) return;

                     // Display the indicator icon
                     this.$dateDisplayField.html('<span class="fa fa-spinner fa-spin" aria-hidden="true"></span>');

                     $.ajax({
                         type: 'POST',
                         url: this.enrollUrl,
                         contentType: 'application/json',
                         dataType: 'json',
                         data: JSON.stringify({
                             is_active: !isUnenrolling,
                             course_details: {
                                 course_id: this.currentSessionSelection,
                                 course_uuid: this.entitlementModel.get('entitlementUUID')
                             }
                         }),
                         success: _.bind(this.enrollSuccess, this),
                         error: _.bind(this.enrollError, this)
                     });
                 },

                 enrollSuccess: function(data) {
                     /*
                     Update external elements on the course card to represent the now available course session.

                     On enroll:
                     1) Show the change session toggle button.
                     2) Add the new session's dates to the date field on the main course card.
                     3) Hide the 'View Course' button to the course card.

                     On unenroll:
                     1) Hide the change session button and the date field.
                     2) Hide the 'View Course' button.
                     3) Remove the messages associated with the enrolled state.
                     4) Remove the link from the course card image and title.
                     */
                     var enrolled = data.is_active;

                     // Update the model with the new session Id;
                     this.entitlementModel.set({currentSessionId: this.currentSessionSelection});
                     if (enrolled) {
                         this.$triggerOpenBtn.removeClass('hidden');
                         this.$dateDisplayField.html(this.getAvailableSessionWithId(data.course_details.course_id)
                             .session_dates).prepend('<span class="fa fa-check" aria-hidden="true"></span>');
                         this.$enterCourseBtn.attr('href', this.formatCourseHomeUrl(data.course_details.course_id))
                             .removeClass('hidden');
                         this.toggleSessionSelectionPanel();
                     } else {
                         // Reset the card contents to the unenrolled state
                         this.$triggerOpenBtn.addClass('hidden');
                         this.$enterCourseBtn.addClass('hidden');
                         this.$dateDisplayField.html('');
                         this.$courseCardMessages.remove();

                         // Remove links to previously enrolled sessions
                         this.$courseImageLink.replaceWith('<div class="' + this.$courseImageLink.attr('class') +
                             '" tabindex="-1">' + this.$courseImageLink.html() + '</div>');
                         this.$courseTitleLink.replaceWith('<span>' + this.$courseTitleLink.text() + '</span>');
                     }
                 },

                 enrollError: function() {
                     this.$dateDisplayField.find('.fa.fa-spin').removeClass('fa-spin fa-spinner').addClass('fa-close');
                     this.$dateDisplayField
                         .append(gettext('There was an error, please reload the page and try again.'));
                     this.hideVerificationDialog();
                 },

                 updateEnrollBtn: function() {
                     /*
                     This function is invoked on load, on opening the view and on changing the option on the session
                     selection dropdown. It plays three roles:
                     1) Enables and disables enroll button
                     2) Changes text to describe the action taken
                     3) Formats the confirmation popover to allow for two step authentication
                     */
                     var enrollText,
                         confirmationHTML,
                         currentSessionId = this.entitlementModel.get('currentSessionId'),
                         newSessionId = this.$('.session-select').find('option:selected').data('session_id'),
                         enrollBtnInitial = this.$('.enroll-btn-initial');

                     // Disable the button if the user is already enrolled in that session.
                     if (currentSessionId === newSessionId) {
                         enrollBtnInitial.addClass('disabled');
                         enrollBtnInitial.popover('dispose');
                         return;
                     }
                     enrollBtnInitial.removeClass('disabled');

                     // Update button text specifying if the user is initially enrolling, changing or leaving a session.
                     if (newSessionId) {
                         enrollText = currentSessionId ? gettext('Change Session') : gettext('Select Session');
                     } else {
                         enrollText = gettext('Leave Current Session');
                     }
                     this.$('.enroll-btn-initial').text(enrollText);

                     // Update the button popover text to enable two step authentication.
                     if (newSessionId) {
                         confirmationHTML = currentSessionId ?
                             gettext('Are you sure that you would like to switch session?') + '<br><br>' +
                             gettext(' Please know that by choosing to switch session you will lose any progress you' +
                             'have made in this session.') :
                             gettext('Are you sure that you would like to select this session?');
                     } else {
                         confirmationHTML = gettext('Are you sure that you would like to leave this session?') +
                             '<br><br>' + gettext('Please know that by leaving you will lose any progress you had' +
                             ' made in this session.');
                     }

                     // Remove existing popover and re-initialize
                     enrollBtnInitial.popover('dispose');
                     enrollBtnInitial.popover({
                         placement: 'bottom',
                         container: this.$el,
                         html: true,
                         trigger: 'click',
                         content: '<div class="verification-modal" role="dialog"' +
                             'aria-labelledby="enrollment-verification-title">' +
                             '<p id="enrollment-verification-title">' + confirmationHTML + '</p>' +
                             '<div class="action-items">' +
                             '<button type="button" class="popover-dismiss final-confirmation-btn">' +
                             gettext('No') + '</button>' +
                             '<button type="button" class="enroll-btn final-confirmation-btn">' +
                             gettext('Yes') + '</button></div></div>'
                     });

                     // Close popover on click-away
                     $(document).on('click', function(e) {
                         if (!($(e.target).closest('.enroll-btn-initial, .popover').length)) {
                             this.$('.enroll-btn-initial').popover('hide');
                         }
                     }.bind(this));

                     // Ensure that focus moves to the popover on click of the initial change enrollment button.
                     this.$('.enroll-btn-initial').on('click', function() {
                         this.$('.final-confirmation-btn:first').focus();
                     }.bind(this));
                 },

                 handleVerificationPopoverA11y: function(e) {
                     /* Ensure that the second step verification popover is treated as an a11y compliant dialog */
                     var nextButton,
                         openButton = $(e.target).closest('.course-entitlement-selection-container')
                             .find('.enroll-btn-initial');
                     if (e.key === 'Tab') {
                         e.preventDefault();
                         nextButton = $(e.target).is(':first-child') ? $(e.target).next('.final-confirmation-btn') :
                             $(e.target).prev('.final-confirmation-btn');
                         nextButton.focus();
                     } else if (e.key === 'Escape') {
                         openButton.popover('hide');
                         openButton.focus();
                     }
                 },

                 hideVerificationDialog: function() {
                     this.$('.enroll-btn-initial').focus().popover('hide');
                 },

                 formatCourseHomeUrl: function(sessionKey) {
                     /*
                     Takes the base course home URL and updates it with the new session id, leveraging the
                     the fact that all course keys contain a '+' symbol.
                     */
                     var oldSessionKey = this.courseHomeUrl.split('/').filter(function(x) { return x.indexOf('+') > 0; })[0];  // eslint-disable-line max-len
                     return this.courseHomeUrl.replace(oldSessionKey, sessionKey);
                 },

                 formatDates: function(sessionData) {
                     /*
                     Takes a data object containing the upcoming available sessions for an entitlement and returns
                     the object with a session_dates attribute representing a formatted date string that highlights
                     the start and end dates of the particular session.
                      */
                     var formattedSessionData = sessionData,
                         startDate,
                         endDate,
                         dateFormat;
                     moment.locale(window.navigator.userLanguage || window.navigator.language);
                     dateFormat = moment.localeData().longDateFormat('L').indexOf('DD') >
                         moment.localeData().longDateFormat('L').indexOf('MM') ? 'MMMM D, YYYY' : 'D MMMM, YYYY';

                     return _.map(formattedSessionData, function(session) {
                         var formattedSession = session;
                         startDate = formattedSession.session_start ?
                             moment((new Date(formattedSession.session_start))).format(dateFormat) : null;
                         endDate = formattedSession.session_end ?
                             moment((new Date(formattedSession.session_end))).format(dateFormat) : null;
                         formattedSession.session_dates = this.courseCardModel.formatDateString({
                             start_date: startDate,
                             end_date: endDate,
                             pacing_type: formattedSession.pacing_type
                         });
                         formattedSession.enrollment_end = formattedSession.enrollment_end ?
                             moment((new Date(formattedSession.enrollment_end))).format(dateFormat) : null;
                         return formattedSession;
                     }, this);
                 },

                 getAvailableSessionWithId: function(sessionId) {
                     /* Returns an available session given a sessionId */
                     var availableSessions = this.entitlementModel.get('availableSessions').filter(function(x) {
                         return x.session_id === sessionId;
                     });
                     return availableSessions ? availableSessions[0] : '';
                 }
             });
         }
    );
}).call(this, define || RequireJS.define);
