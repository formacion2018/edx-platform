import logging

from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from edx_rest_framework_extensions.authentication import JwtAuthentication
from rest_framework import permissions, viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.response import Response

from entitlements.api.v1.filters import CourseEntitlementFilter
from entitlements.models import CourseEntitlement
from entitlements.api.v1.serializers import CourseEntitlementSerializer
from student.models import CourseEnrollment

from datetime import datetime
from openedx.core.djangoapps.site_configuration.helpers import get_dict
from entitlements.helpers import is_entitlement_expired

log = logging.getLogger(__name__)


class EntitlementViewSet(viewsets.ModelViewSet):
    authentication_classes = (JwtAuthentication, SessionAuthentication,)
    permission_classes = (permissions.IsAuthenticated, permissions.IsAdminUser,)
    queryset = CourseEntitlement.objects.all().select_related('user')
    lookup_value_regex = '[0-9a-f-]+'
    lookup_field = 'uuid'
    serializer_class = CourseEntitlementSerializer
    filter_backends = (DjangoFilterBackend,)
    filter_class = CourseEntitlementFilter

    def retrieve(self, request, *args, **kwargs):
        """
        Override the retrieve method to expire a record that is past the
        policy and is requested via the API before returning that record.
        """
        instance = self.get_object()
        if not instance.expired_at:
            site_configuration_policy = get_dict('ENTITLEMENT_POLICY')
            if is_entitlement_expired(instance, site_configuration_policy):
                instance.expired_at = datetime.utcnow()
                instance.save()
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    def list(self, request, *args, **kwargs):
        """
        Override the list method to expire records that are past the
        policy and requested via the API before returning those records.
        """
        queryset = self.filter_queryset(self.get_queryset())

        site_configuration_policy = get_dict('ENTITLEMENT_POLICY')
        for entitlement in queryset:
            if not entitlement.expired_at and is_entitlement_expired(entitlement, site_configuration_policy):
                entitlement.expired_at = datetime.utcnow()
                entitlement.save()

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def perform_destroy(self, instance):
        """
        This method is an override and is called by the DELETE method
        """
        save_model = False
        if instance.expired_at is None:
            instance.expired_at = timezone.now()
            log.info('Set expired_at to [%s] for course entitlement [%s]', instance.expired_at, instance.uuid)
            save_model = True

        if instance.enrollment_course_run is not None:
            CourseEnrollment.unenroll(
                user=instance.user,
                course_id=instance.enrollment_course_run.course_id,
                skip_refund=True
            )
            enrollment = instance.enrollment_course_run
            instance.enrollment_course_run = None
            save_model = True
            log.info(
                'Unenrolled user [%s] from course run [%s] as part of revocation of course entitlement [%s]',
                instance.user.username,
                enrollment.course_id,
                instance.uuid
            )
        if save_model:
            instance.save()
